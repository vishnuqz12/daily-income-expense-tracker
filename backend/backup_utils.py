from __future__ import annotations

import csv
import io
import uuid
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Bank, FinancialPeriod, Transaction, Transfer

TABLE_NAMES = {"banks", "periods", "transactions", "transfers"}
MAX_BACKUP_BYTES = 10 * 1024 * 1024


def parse_dt(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def parse_money(value: str | None) -> Decimal:
    try:
        return Decimal(str(value or "0")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return Decimal("0.00")


def _read_rows(archive: zipfile.ZipFile, filename: str) -> list[dict[str, str]]:
    if filename not in archive.namelist():
        return []
    with archive.open(filename, "r") as raw:
        return list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", newline="")))


def import_backup_zip(db: Session, user_id: str, raw_bytes: bytes) -> dict[str, int]:
    if len(raw_bytes) > MAX_BACKUP_BYTES:
        raise ValueError("Backup file is larger than the 10 MB safety limit")

    try:
        archive = zipfile.ZipFile(io.BytesIO(raw_bytes), "r")
    except zipfile.BadZipFile as exc:
        raise ValueError("The selected backup is not a valid ZIP file") from exc

    with archive:
        names = set(archive.namelist())
        unexpected = [name for name in names if not (name.startswith("__MACOSX/") or (name.endswith(".csv") and name.split("/")[-1] in {x + ".csv" for x in TABLE_NAMES | {"users", "sessions"}}))]
        if unexpected:
            raise ValueError("Backup contains unsupported files")

        bank_rows = _read_rows(archive, "banks.csv")
        period_rows = _read_rows(archive, "periods.csv")
        transaction_rows = _read_rows(archive, "transactions.csv")
        transfer_rows = _read_rows(archive, "transfers.csv")

    bank_map: dict[str, str] = {}
    bank_count = 0
    period_count = 0
    transaction_count = 0
    transfer_count = 0
    skipped_transactions = 0
    skipped_transfers = 0

    current_banks = db.scalars(select(Bank).where(Bank.user_id == user_id)).all()
    bank_by_name = {b.name.casefold(): b.id for b in current_banks}

    for row in bank_rows:
        old_id = (row.get("id") or "").strip()
        name = " ".join((row.get("name") or "Bank").split())[:60]
        if not old_id or not name:
            continue
        existing_id = bank_by_name.get(name.casefold())
        if existing_id:
            bank_map[old_id] = existing_id
            continue
        candidate_id = old_id
        existing_any = db.get(Bank, candidate_id)
        if existing_any:
            candidate_id = str(uuid.uuid4())
        bank = Bank(id=candidate_id, user_id=user_id, name=name, created_at=parse_dt(row.get("created_at")))
        db.add(bank)
        db.flush()
        bank_map[old_id] = bank.id
        bank_by_name[name.casefold()] = bank.id
        bank_count += 1

    existing_period_starts = {
        p.start_date for p in db.scalars(select(FinancialPeriod).where(FinancialPeriod.user_id == user_id)).all()
    }
    existing_period_ids = {
        p.id for p in db.scalars(select(FinancialPeriod).where(FinancialPeriod.user_id == user_id)).all()
    }
    for row in period_rows:
        old_id = (row.get("id") or "").strip()
        if not old_id or old_id in existing_period_ids:
            continue
        try:
            start = date.fromisoformat(row.get("start_date", ""))
        except ValueError:
            continue
        if start in existing_period_starts:
            continue
        candidate_id = old_id if not db.get(FinancialPeriod, old_id) else str(uuid.uuid4())
        db.add(FinancialPeriod(id=candidate_id, user_id=user_id, start_date=start, created_at=parse_dt(row.get("created_at"))))
        existing_period_ids.add(candidate_id)
        existing_period_starts.add(start)
        period_count += 1

    db.flush()
    for row in transaction_rows:
        old_id = (row.get("id") or "").strip()
        if not old_id:
            continue
        existing = db.get(Transaction, old_id)
        if existing and existing.user_id == user_id:
            continue
        bank_id = bank_map.get((row.get("bank_id") or "").strip())
        tx_type = row.get("type")
        try:
            tx_date = date.fromisoformat(row.get("date", ""))
        except ValueError:
            skipped_transactions += 1
            continue
        amount = parse_money(row.get("amount"))
        if not bank_id or tx_type not in {"income", "expense"} or amount <= 0:
            skipped_transactions += 1
            continue
        candidate_id = old_id if not existing else str(uuid.uuid4())
        db.add(Transaction(
            id=candidate_id,
            user_id=user_id,
            bank_id=bank_id,
            type=tx_type,
            amount=amount,
            category=(row.get("category") or "Other").strip()[:50],
            date=tx_date,
            note=(row.get("note") or "").strip()[:200],
            created_at=parse_dt(row.get("created_at")),
        ))
        transaction_count += 1

    db.flush()
    for row in transfer_rows:
        old_id = (row.get("id") or "").strip()
        if not old_id:
            continue
        existing = db.get(Transfer, old_id)
        if existing and existing.user_id == user_id:
            continue
        from_id = bank_map.get((row.get("from_bank_id") or "").strip())
        to_id = bank_map.get((row.get("to_bank_id") or "").strip())
        try:
            transfer_date = date.fromisoformat(row.get("date", ""))
        except ValueError:
            skipped_transfers += 1
            continue
        amount = parse_money(row.get("amount"))
        if not from_id or not to_id or from_id == to_id or amount <= 0:
            skipped_transfers += 1
            continue
        candidate_id = old_id if not existing else str(uuid.uuid4())
        db.add(Transfer(
            id=candidate_id,
            user_id=user_id,
            from_bank_id=from_id,
            to_bank_id=to_id,
            amount=amount,
            date=transfer_date,
            note=(row.get("note") or "").strip()[:200],
            created_at=parse_dt(row.get("created_at")),
        ))
        transfer_count += 1

    db.commit()
    return {
        "banks_added": bank_count,
        "periods_added": period_count,
        "transactions_added": transaction_count,
        "transactions_skipped": skipped_transactions,
        "transfers_added": transfer_count,
        "transfers_skipped": skipped_transfers,
    }
