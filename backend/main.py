from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import os
import secrets
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from database import SessionLocal, create_all
from models import Bank, FinancialPeriod, Session as DbSession, Transaction, Transfer, User, utc_now
from backup_utils import MAX_BACKUP_BYTES, import_backup_zip


APP_NAME = "Daily Money Tracker API"
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
LEGACY_DIR = Path(__file__).parent / "data"
LEGACY_ARCHIVE = LEGACY_DIR / "finance_data.zip"
LEGACY_JSON = LEGACY_DIR / "finance.json"
TOKEN_DAYS = int(os.getenv("SESSION_DAYS", "30"))
TOKEN_BYTES = 32
PBKDF2_ITERATIONS = int(os.getenv("PBKDF2_ITERATIONS", "220000"))
security = HTTPBearer(auto_error=False)


def cors_origins() -> list[str]:
    configured = os.getenv("CORS_ORIGINS", "").strip()
    if configured:
        return [x.strip().rstrip("/") for x in configured.split(",") if x.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_all()
    try:
        migrate_legacy_file_storage()
    except Exception as exc:
        # A bad legacy file must not stop a clean PostgreSQL deployment.
        print(f"Legacy migration skipped: {exc}")
    yield


app = FastAPI(title=APP_NAME, version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class LoginPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class BankCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Bank name is required")
        return cleaned


class PeriodCreate(BaseModel):
    start_date: date


class TransactionCreate(BaseModel):
    bank_id: str
    type: Literal["income", "expense"]
    amount: Decimal = Field(gt=Decimal("0"), max_digits=14, decimal_places=2)
    category: str = Field(min_length=1, max_length=50)
    date: date
    note: Optional[str] = Field(default="", max_length=200)


class TransferCreate(BaseModel):
    from_bank_id: str
    to_bank_id: str
    amount: Decimal = Field(gt=Decimal("0"), max_digits=14, decimal_places=2)
    date: date
    note: Optional[str] = Field(default="", max_length=200)


def money(value: Decimal | float | int | None) -> float:
    if value is None:
        return 0.0
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str, salt_hex: Optional[str] = None):
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, expected_hex: str) -> bool:
    _, actual_hex = hash_password(password, salt_hex)
    return hmac.compare_digest(actual_hex, expected_hex)


def new_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    return raw, token_hash(raw)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Please log in to continue")
    session = db.scalar(select(DbSession).where(DbSession.token_hash == token_hash(credentials.credentials)))
    if not session:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now_utc():
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    user = db.get(User, session.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User account not found")
    return user


def period_rows(db: Session, user_id: str) -> list[FinancialPeriod]:
    return list(db.scalars(select(FinancialPeriod).where(FinancialPeriod.user_id == user_id).order_by(FinancialPeriod.start_date.asc())))


def period_end(periods: list[FinancialPeriod], index: int) -> Optional[date]:
    if index + 1 < len(periods):
        return periods[index + 1].start_date - timedelta(days=1)
    return None


def period_view(periods: list[FinancialPeriod], index: int) -> dict:
    p = periods[index]
    end = period_end(periods, index)
    return {
        "id": p.id,
        "user_id": p.user_id,
        "start_date": p.start_date.isoformat(),
        "created_at": p.created_at.isoformat(),
        "end_date": end.isoformat() if end else None,
        "label": f"{p.start_date.strftime('%d %b %Y')} – {end.strftime('%d %b %Y') if end else 'Current'}",
    }


def period_by_id(db: Session, user_id: str, period_id: str) -> tuple[FinancialPeriod, list[FinancialPeriod], int]:
    periods = period_rows(db, user_id)
    for index, period in enumerate(periods):
        if period.id == period_id:
            return period, periods, index
    raise HTTPException(status_code=404, detail="Financial month not found")


def period_for_date(db: Session, user_id: str, target_date: date) -> Optional[FinancialPeriod]:
    return db.scalar(
        select(FinancialPeriod)
        .where(FinancialPeriod.user_id == user_id, FinancialPeriod.start_date <= target_date)
        .order_by(FinancialPeriod.start_date.desc())
        .limit(1)
    )


def period_transactions(
    db: Session,
    user_id: str,
    period_id: str,
    bank_id: Optional[str] = None,
) -> list[Transaction]:
    period, periods, index = period_by_id(db, user_id, period_id)
    next_start = periods[index + 1].start_date if index + 1 < len(periods) else None
    query = select(Transaction).where(
        Transaction.user_id == user_id,
        Transaction.date >= period.start_date,
    )
    if next_start:
        query = query.where(Transaction.date < next_start)
    if bank_id:
        query = query.where(Transaction.bank_id == bank_id)
    return list(db.scalars(query.order_by(Transaction.date.desc(), Transaction.created_at.desc())))


def period_transfers(
    db: Session,
    user_id: str,
    period_id: str,
    bank_id: Optional[str] = None,
) -> list[Transfer]:
    period, periods, index = period_by_id(db, user_id, period_id)
    next_start = periods[index + 1].start_date if index + 1 < len(periods) else None
    query = select(Transfer).where(Transfer.user_id == user_id, Transfer.date >= period.start_date)
    if next_start:
        query = query.where(Transfer.date < next_start)
    if bank_id:
        query = query.where((Transfer.from_bank_id == bank_id) | (Transfer.to_bank_id == bank_id))
    return list(db.scalars(query.order_by(Transfer.date.desc(), Transfer.created_at.desc())))


def aggregate(items: list[Transaction]) -> dict:
    income = sum((x.amount for x in items if x.type == "income"), Decimal("0"))
    expense = sum((x.amount for x in items if x.type == "expense"), Decimal("0"))
    return {
        "income": money(income),
        "expense": money(expense),
        "savings": money(income - expense),
        "transaction_count": len(items),
    }


def bank_balance(db: Session, user_id: str, bank_id: str) -> float:
    income = db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user_id, Transaction.bank_id == bank_id, Transaction.type == "income"
        )
    ) or 0
    expense = db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user_id, Transaction.bank_id == bank_id, Transaction.type == "expense"
        )
    ) or 0
    transfer_in = db.scalar(
        select(func.coalesce(func.sum(Transfer.amount), 0)).where(
            Transfer.user_id == user_id, Transfer.to_bank_id == bank_id
        )
    ) or 0
    transfer_out = db.scalar(
        select(func.coalesce(func.sum(Transfer.amount), 0)).where(
            Transfer.user_id == user_id, Transfer.from_bank_id == bank_id
        )
    ) or 0
    return money(Decimal(str(income)) - Decimal(str(expense)) + Decimal(str(transfer_in)) - Decimal(str(transfer_out)))


def percentage_change(current: float, previous: float) -> Optional[float]:
    if previous == 0:
        return None if current == 0 else 100.0
    return round(((current - previous) / previous) * 100, 1)


def all_user_transactions(db: Session, user_id: str) -> list[Transaction]:
    return list(db.scalars(select(Transaction).where(Transaction.user_id == user_id)))


# ---------------------------------------------------------------------------
# Legacy CSV/JSON migration helpers. New writes always go to PostgreSQL.
# ---------------------------------------------------------------------------
LEGACY_TABLES = {
    "users": ["id", "email", "password_salt", "password_hash", "created_at"],
    "sessions": ["token", "user_id", "expires_at"],
    "banks": ["id", "user_id", "name", "created_at"],
    "transactions": ["id", "user_id", "bank_id", "type", "amount", "category", "date", "note", "created_at"],
    "periods": ["id", "user_id", "start_date", "created_at"],
    "transfers": ["id", "user_id", "from_bank_id", "to_bank_id", "amount", "date", "note", "created_at"],
}


def read_legacy_archive(path: Path) -> dict[str, list[dict]]:
    data = {name: [] for name in LEGACY_TABLES}
    with zipfile.ZipFile(path, "r") as archive:
        names = set(archive.namelist())
        for table, columns in LEGACY_TABLES.items():
            filename = f"{table}.csv"
            if filename not in names:
                continue
            with archive.open(filename, "r") as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", newline=""))
                data[table] = [{key: row.get(key, "") for key in columns} for row in reader]
    return data


def read_legacy_json(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return {"banks": [], "transactions": raw}
    return raw if isinstance(raw, dict) else {}


def parse_dt(value: str | None) -> datetime:
    if not value:
        return utc_now()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return utc_now()


def parse_decimal(value: str | None) -> Decimal:
    try:
        return Decimal(str(value or "0")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return Decimal("0.00")


def migrate_legacy_file_storage() -> None:
    db = SessionLocal()
    try:
        if db.scalar(select(func.count(User.id))) or 0:
            return

        if LEGACY_ARCHIVE.exists():
            raw = read_legacy_archive(LEGACY_ARCHIVE)
        elif LEGACY_JSON.exists():
            raw = read_legacy_json(LEGACY_JSON)
        else:
            return

        legacy_users = raw.get("users") or []
        valid_users = [u for u in legacy_users if u.get("email") and u.get("password_hash") and u.get("password_salt")]
        if not valid_users:
            # A browser-exported backup intentionally contains no password hash.
            # Use the authenticated import tool/script for that backup instead.
            return

        user_ids = set()
        for item in valid_users:
            email = item["email"].strip().lower()
            if db.scalar(select(User).where(User.email == email)):
                continue
            user = User(
                id=item["id"] or str(uuid.uuid4()),
                email=email,
                password_salt=item["password_salt"],
                password_hash=item["password_hash"],
                created_at=parse_dt(item.get("created_at")),
            )
            db.add(user)
            user_ids.add(user.id)

        db.flush()
        valid_user_ids = {u.id for u in db.scalars(select(User))}

        for item in raw.get("banks") or []:
            if not item.get("id") or item.get("user_id") not in valid_user_ids:
                continue
            db.add(Bank(id=item["id"], user_id=item["user_id"], name=item.get("name", "Bank"), created_at=parse_dt(item.get("created_at"))))

        db.flush()
        existing_bank_ids = {b.id for b in db.scalars(select(Bank))}

        for item in raw.get("periods") or []:
            if not item.get("id") or item.get("user_id") not in valid_user_ids or not item.get("start_date"):
                continue
            if db.scalar(select(FinancialPeriod).where(FinancialPeriod.id == item["id"])):
                continue
            try:
                start = date.fromisoformat(item["start_date"])
            except ValueError:
                continue
            if db.scalar(select(FinancialPeriod).where(FinancialPeriod.user_id == item["user_id"], FinancialPeriod.start_date == start)):
                continue
            db.add(FinancialPeriod(id=item["id"], user_id=item["user_id"], start_date=start, created_at=parse_dt(item.get("created_at"))))

        db.flush()
        for item in raw.get("transactions") or []:
            if item.get("id") in {x.id for x in db.scalars(select(Transaction))}:
                continue
            if item.get("user_id") not in valid_user_ids or item.get("bank_id") not in existing_bank_ids:
                continue
            try:
                tx_date = date.fromisoformat(item["date"])
            except (KeyError, ValueError):
                continue
            tx_type = item.get("type")
            if tx_type not in {"income", "expense"}:
                continue
            db.add(
                Transaction(
                    id=item["id"] or str(uuid.uuid4()),
                    user_id=item["user_id"],
                    bank_id=item["bank_id"],
                    type=tx_type,
                    amount=parse_decimal(item.get("amount")),
                    category=item.get("category") or "Other",
                    date=tx_date,
                    note=item.get("note") or "",
                    created_at=parse_dt(item.get("created_at")),
                )
            )

        db.flush()
        for item in raw.get("transfers") or []:
            if item.get("id") in {x.id for x in db.scalars(select(Transfer))}:
                continue
            if item.get("user_id") not in valid_user_ids:
                continue
            if item.get("from_bank_id") not in existing_bank_ids or item.get("to_bank_id") not in existing_bank_ids:
                continue
            if item.get("from_bank_id") == item.get("to_bank_id"):
                continue
            try:
                transfer_date = date.fromisoformat(item["date"])
            except (KeyError, ValueError):
                continue
            db.add(
                Transfer(
                    id=item["id"] or str(uuid.uuid4()),
                    user_id=item["user_id"],
                    from_bank_id=item["from_bank_id"],
                    to_bank_id=item["to_bank_id"],
                    amount=parse_decimal(item.get("amount")),
                    date=transfer_date,
                    note=item.get("note") or "",
                    created_at=parse_dt(item.get("created_at")),
                )
            )
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Public / system endpoints
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    if FRONTEND_DIST.exists() and (FRONTEND_DIST / "index.html").exists():
        return FileResponse(FRONTEND_DIST / "index.html")
    return {"message": APP_NAME + " is running"}


@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(select(1))
        return {"status": "ok", "storage": "postgresql", "database": "connected", "version": "2.0.0"}
    except Exception:
        raise HTTPException(status_code=503, detail="Database is unavailable")


@app.post("/auth/register")
def register(payload: RegisterPayload, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    salt, password_hash = hash_password(payload.password)
    user = User(id=str(uuid.uuid4()), email=payload.email, password_salt=salt, password_hash=password_hash)
    db.add(user)
    token, token_digest = new_token()
    db.add(DbSession(token_hash=token_digest, user_id=user.id, expires_at=now_utc() + timedelta(days=TOKEN_DAYS)))
    db.commit()
    return {"token": token, "user": {"id": user.id, "email": user.email}}


@app.post("/auth/login")
def login(payload: LoginPayload, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_password(payload.password, user.password_salt, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    db.execute(delete(DbSession).where(DbSession.user_id == user.id))
    token, token_digest = new_token()
    db.add(DbSession(token_hash=token_digest, user_id=user.id, expires_at=now_utc() + timedelta(days=TOKEN_DAYS)))
    db.commit()
    return {"token": token, "user": {"id": user.id, "email": user.email}}


@app.post("/auth/logout")
def logout(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security), user: User = Depends(current_user), db: Session = Depends(get_db)):
    if credentials:
        db.execute(delete(DbSession).where(DbSession.token_hash == token_hash(credentials.credentials), DbSession.user_id == user.id))
        db.commit()
    return {"message": "Logged out"}


@app.get("/auth/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email}


# ---------------------------------------------------------------------------
# Banks
# ---------------------------------------------------------------------------
@app.get("/banks")
def get_banks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    banks = db.scalars(select(Bank).where(Bank.user_id == user.id).order_by(Bank.created_at.asc())).all()
    return [{"id": b.id, "user_id": b.user_id, "name": b.name, "created_at": b.created_at.isoformat()} for b in banks]


@app.post("/banks")
def create_bank(payload: BankCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.scalar(select(Bank).where(Bank.user_id == user.id, func.lower(Bank.name) == payload.name.lower())):
        raise HTTPException(status_code=409, detail="A bank with this name already exists")
    bank = Bank(id=str(uuid.uuid4()), user_id=user.id, name=payload.name)
    db.add(bank)
    db.commit()
    return {"id": bank.id, "user_id": bank.user_id, "name": bank.name, "created_at": bank.created_at.isoformat()}


@app.delete("/banks/{bank_id}")
def delete_bank(bank_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    bank = db.scalar(select(Bank).where(Bank.id == bank_id, Bank.user_id == user.id))
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")
    db.delete(bank)
    db.commit()
    return {"message": "Bank, transactions and related transfers deleted"}


# ---------------------------------------------------------------------------
# Financial month controls
# ---------------------------------------------------------------------------
@app.get("/periods")
def get_periods(user: User = Depends(current_user), db: Session = Depends(get_db)):
    periods = period_rows(db, user.id)
    return [period_view(periods, i) for i in range(len(periods) - 1, -1, -1)]


@app.post("/periods")
def create_period(payload: PeriodCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    periods = period_rows(db, user.id)
    if any(p.start_date == payload.start_date for p in periods):
        raise HTTPException(status_code=409, detail="A financial month already starts on this date")
    if periods and payload.start_date <= periods[-1].start_date:
        raise HTTPException(status_code=400, detail="New month start date must be after the current month start date")
    period = FinancialPeriod(id=str(uuid.uuid4()), user_id=user.id, start_date=payload.start_date)
    db.add(period)
    db.commit()
    periods = period_rows(db, user.id)
    index = next(i for i, p in enumerate(periods) if p.id == period.id)
    return period_view(periods, index)


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
@app.get("/transactions")
def get_transactions(
    bank_id: Optional[str] = None,
    transaction_type: Optional[Literal["income", "expense"]] = None,
    period_id: Optional[str] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if bank_id and not db.scalar(select(Bank).where(Bank.id == bank_id, Bank.user_id == user.id)):
        raise HTTPException(status_code=404, detail="Bank not found")
    if period_id:
        items = period_transactions(db, user.id, period_id, bank_id)
    else:
        query = select(Transaction).where(Transaction.user_id == user.id)
        if bank_id:
            query = query.where(Transaction.bank_id == bank_id)
        items = list(db.scalars(query.order_by(Transaction.date.desc(), Transaction.created_at.desc())))
    if transaction_type:
        items = [x for x in items if x.type == transaction_type]
    return [transaction_json(x) for x in items]


def transaction_json(item: Transaction) -> dict:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "bank_id": item.bank_id,
        "type": item.type,
        "amount": money(item.amount),
        "category": item.category,
        "date": item.date.isoformat(),
        "note": item.note,
        "created_at": item.created_at.isoformat(),
    }


@app.post("/transactions")
def create_transaction(payload: TransactionCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.scalar(select(Bank).where(Bank.id == payload.bank_id, Bank.user_id == user.id)):
        raise HTTPException(status_code=404, detail="Bank not found")
    if not period_for_date(db, user.id, payload.date):
        raise HTTPException(status_code=400, detail="Start a financial month before recording transactions for this date")
    item = Transaction(
        id=str(uuid.uuid4()),
        user_id=user.id,
        bank_id=payload.bank_id,
        type=payload.type,
        amount=payload.amount.quantize(Decimal("0.01")),
        category=payload.category.strip(),
        date=payload.date,
        note=(payload.note or "").strip(),
    )
    db.add(item)
    db.commit()
    return transaction_json(item)


@app.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = db.scalar(select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user.id))
    if not item:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(item)
    db.commit()
    return {"message": "Transaction deleted"}


@app.get("/summary")
def get_summary(bank_id: Optional[str] = None, period_id: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if bank_id and not db.scalar(select(Bank).where(Bank.id == bank_id, Bank.user_id == user.id)):
        raise HTTPException(status_code=404, detail="Bank not found")
    items = period_transactions(db, user.id, period_id, bank_id) if period_id else list(
        db.scalars(select(Transaction).where(Transaction.user_id == user.id, *( [Transaction.bank_id == bank_id] if bank_id else [] )))
    )
    result = aggregate(items)
    if bank_id:
        result["bank_balance"] = bank_balance(db, user.id, bank_id)
    return result


@app.get("/monthly-summary")
def monthly_summary(bank_id: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if bank_id and not db.scalar(select(Bank).where(Bank.id == bank_id, Bank.user_id == user.id)):
        raise HTTPException(status_code=404, detail="Bank not found")
    periods = period_rows(db, user.id)
    all_items = list(db.scalars(select(Transaction).where(Transaction.user_id == user.id)))
    result = []
    for index, period in enumerate(periods):
        end = period_end(periods, index)
        items = [
            t for t in all_items
            if t.date >= period.start_date and (end is None or t.date <= end) and (not bank_id or t.bank_id == bank_id)
        ]
        result.append({"period_id": period.id, **period_view(periods, index), **aggregate(items)})
    return list(reversed(result))


# ---------------------------------------------------------------------------
# Transfers
# ---------------------------------------------------------------------------
def transfer_json(item: Transfer, bank_names: dict[str, str]) -> dict:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "from_bank_id": item.from_bank_id,
        "to_bank_id": item.to_bank_id,
        "amount": money(item.amount),
        "date": item.date.isoformat(),
        "note": item.note,
        "created_at": item.created_at.isoformat(),
        "from_bank_name": bank_names.get(item.from_bank_id, "Unknown"),
        "to_bank_name": bank_names.get(item.to_bank_id, "Unknown"),
    }


@app.get("/transfers")
def get_transfers(
    bank_id: Optional[str] = None,
    period_id: Optional[str] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if bank_id and not db.scalar(select(Bank).where(Bank.id == bank_id, Bank.user_id == user.id)):
        raise HTTPException(status_code=404, detail="Bank not found")
    items = period_transfers(db, user.id, period_id, bank_id) if period_id else list(
        db.scalars(select(Transfer).where(Transfer.user_id == user.id).order_by(Transfer.date.desc(), Transfer.created_at.desc()))
    )
    banks = db.scalars(select(Bank).where(Bank.user_id == user.id)).all()
    names = {b.id: b.name for b in banks}
    return [transfer_json(x, names) for x in items]


@app.post("/transfers")
def create_transfer(payload: TransferCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if payload.from_bank_id == payload.to_bank_id:
        raise HTTPException(status_code=400, detail="Choose two different bank accounts")
    valid_ids = set(db.scalars(select(Bank.id).where(Bank.user_id == user.id)).all())
    if payload.from_bank_id not in valid_ids or payload.to_bank_id not in valid_ids:
        raise HTTPException(status_code=404, detail="Both bank accounts must belong to your profile")
    if not period_for_date(db, user.id, payload.date):
        raise HTTPException(status_code=400, detail="Start a financial month before recording a transfer for this date")
    item = Transfer(
        id=str(uuid.uuid4()),
        user_id=user.id,
        from_bank_id=payload.from_bank_id,
        to_bank_id=payload.to_bank_id,
        amount=payload.amount.quantize(Decimal("0.01")),
        date=payload.date,
        note=(payload.note or "").strip(),
    )
    db.add(item)
    db.commit()
    names = {b.id: b.name for b in db.scalars(select(Bank).where(Bank.user_id == user.id)).all()}
    return transfer_json(item, names)


@app.delete("/transfers/{transfer_id}")
def delete_transfer(transfer_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = db.scalar(select(Transfer).where(Transfer.id == transfer_id, Transfer.user_id == user.id))
    if not item:
        raise HTTPException(status_code=404, detail="Transfer not found")
    db.delete(item)
    db.commit()
    return {"message": "Transfer deleted"}


# ---------------------------------------------------------------------------
# Dashboard / reporting
# ---------------------------------------------------------------------------
@app.get("/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    periods = period_rows(db, user.id)
    all_tx = all_user_transactions(db, user.id)
    total_savings = money(sum((t.amount if t.type == "income" else -t.amount for t in all_tx), Decimal("0")))
    if not periods:
        return {
            "current_period": None,
            "previous_period": None,
            "comparison": {"expense_change": 0, "expense_change_pct": None, "income_change": 0, "income_change_pct": None},
            "total_savings": total_savings,
        }

    def period_aggregate(period_index: int) -> dict:
        p = periods[period_index]
        end = period_end(periods, period_index)
        items = [t for t in all_tx if t.date >= p.start_date and (end is None or t.date <= end)]
        return {**period_view(periods, period_index), **aggregate(items)}

    current = period_aggregate(len(periods) - 1)
    previous = period_aggregate(len(periods) - 2) if len(periods) >= 2 else None
    prev_expense = previous["expense"] if previous else 0
    prev_income = previous["income"] if previous else 0
    return {
        "current_period": current,
        "previous_period": previous,
        "comparison": {
            "expense_change": round(current["expense"] - prev_expense, 2),
            "expense_change_pct": percentage_change(current["expense"], prev_expense),
            "income_change": round(current["income"] - prev_income, 2),
            "income_change_pct": percentage_change(current["income"], prev_income),
        },
        "total_savings": total_savings,
    }


# ---------------------------------------------------------------------------
# User backup export. Secrets are never included in the download.
# ---------------------------------------------------------------------------
@app.post("/backup/import")
async def import_backup(file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please select a ZIP backup file")
    raw = await file.read()
    if len(raw) > MAX_BACKUP_BYTES:
        raise HTTPException(status_code=413, detail="Backup file is larger than the 10 MB safety limit")
    try:
        counts = import_backup_zip(db, user.id, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": "Backup restored successfully", **counts}


@app.get("/backup/export")
def export_backup(user: User = Depends(current_user), db: Session = Depends(get_db)):
    payload = {
        "users": [{"id": user.id, "email": user.email, "password_salt": "", "password_hash": "", "created_at": user.created_at.isoformat()}],
        "sessions": [],
        "banks": [],
        "transactions": [],
        "periods": [],
        "transfers": [],
    }
    banks = db.scalars(select(Bank).where(Bank.user_id == user.id)).all()
    periods = db.scalars(select(FinancialPeriod).where(FinancialPeriod.user_id == user.id)).all()
    transactions = db.scalars(select(Transaction).where(Transaction.user_id == user.id)).all()
    transfers = db.scalars(select(Transfer).where(Transfer.user_id == user.id)).all()
    payload["banks"] = [{"id": b.id, "user_id": b.user_id, "name": b.name, "created_at": b.created_at.isoformat()} for b in banks]
    payload["periods"] = [{"id": p.id, "user_id": p.user_id, "start_date": p.start_date.isoformat(), "created_at": p.created_at.isoformat()} for p in periods]
    payload["transactions"] = [transaction_json(t) for t in transactions]
    payload["transfers"] = [
        {
            "id": t.id,
            "user_id": t.user_id,
            "from_bank_id": t.from_bank_id,
            "to_bank_id": t.to_bank_id,
            "amount": money(t.amount),
            "date": t.date.isoformat(),
            "note": t.note,
            "created_at": t.created_at.isoformat(),
        }
        for t in transfers
    ]

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for table, rows in payload.items():
            columns = LEGACY_TABLES[table]
            text_buffer = io.StringIO(newline="")
            writer = csv.DictWriter(text_buffer, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                writer.writerow({key: "" if row.get(key) is None else row.get(key, "") for key in columns})
            archive.writestr(f"{table}.csv", text_buffer.getvalue().encode("utf-8"))

    out.seek(0)
    filename = f"daily-money-tracker-{user.id[:8]}-backup.zip"
    return StreamingResponse(out, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---------------------------------------------------------------------------
# Serve the built PWA from the backend when frontend/dist exists.
# ---------------------------------------------------------------------------
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/manifest.webmanifest")
    def pwa_manifest():
        return FileResponse(FRONTEND_DIST / "manifest.webmanifest", media_type="application/manifest+json")

    @app.get("/sw.js")
    def pwa_service_worker():
        return FileResponse(FRONTEND_DIST / "sw.js", media_type="application/javascript")

    @app.get("/icons/{icon_name}")
    def pwa_icon(icon_name: str):
        file = FRONTEND_DIST / "icons" / icon_name
        if not file.exists():
            raise HTTPException(status_code=404, detail="Icon not found")
        return FileResponse(file)

    @app.get("/{path:path}")
    def serve_react_app(path: str):
        requested = FRONTEND_DIST / path
        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(FRONTEND_DIST / "index.html")
