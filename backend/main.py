from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import date, datetime, timedelta
from pathlib import Path
import hashlib
import hmac
import json
import secrets
import uuid

app = FastAPI(title='Daily Income & Expense Tracker API')

# The frontend sends the bearer token in an Authorization header, so cookies are not required.
# Allowing all origins keeps the Render frontend/backend split simple; the bearer token still
# protects user data at the API level.
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

DATA_DIR = Path(__file__).parent / 'data'
DATA_DIR.mkdir(exist_ok=True)
DATA_FILE = DATA_DIR / 'finance.json'
FRONTEND_DIST = Path(__file__).parent.parent / 'frontend' / 'dist'
TOKEN_DAYS = 30
security = HTTPBearer(auto_error=False)


def empty_data():
    return {'users': [], 'sessions': [], 'banks': [], 'transactions': [], 'periods': []}


def load_data():
    if not DATA_FILE.exists():
        return empty_data()
    try:
        raw = json.loads(DATA_FILE.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, FileNotFoundError):
        return empty_data()

    # Backward compatibility with the previous single-user format.
    if isinstance(raw, list):
        raw = {'banks': [], 'transactions': raw}
    if not isinstance(raw, dict):
        raw = empty_data()

    data = empty_data()
    for key in data:
        if isinstance(raw.get(key), list):
            data[key] = raw[key]

    # Older version stored users/banks/transactions only. Keep them as orphaned records
    # until the first account is registered; those records are then assigned to that user.
    return data


def save_data(data):
    temp_file = DATA_FILE.with_suffix('.tmp')
    temp_file.write_text(json.dumps(data, indent=2), encoding='utf-8')
    temp_file.replace(DATA_FILE)


def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'


def hash_password(password: str, salt_hex: Optional[str] = None):
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 220_000)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, expected_hex: str):
    _, actual_hex = hash_password(password, salt_hex)
    return hmac.compare_digest(actual_hex, expected_hex)


def find_user_by_email(data, email):
    email = email.strip().lower()
    return next((u for u in data['users'] if u['email'] == email), None)


def migrate_orphaned_records_to_user(data, user_id):
    # Preserve data from the old single-user app when the first account is created.
    if len(data['users']) != 1:
        return
    bank_ids = set()
    for bank in data['banks']:
        if not bank.get('user_id'):
            bank['user_id'] = user_id
        if bank.get('user_id') == user_id:
            bank_ids.add(bank['id'])
    for item in data['transactions']:
        if not item.get('user_id') and item.get('bank_id') in bank_ids:
            item['user_id'] = user_id


def current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail='Please log in to continue')
    data = load_data()
    token = credentials.credentials
    session = next((s for s in data['sessions'] if s['token'] == token), None)
    if not session:
        raise HTTPException(status_code=401, detail='Session expired. Please log in again.')
    try:
        expires = datetime.fromisoformat(session['expires_at'].replace('Z', '+00:00'))
        if expires < datetime.now(expires.tzinfo):
            data['sessions'] = [s for s in data['sessions'] if s['token'] != token]
            save_data(data)
            raise HTTPException(status_code=401, detail='Session expired. Please log in again.')
    except ValueError:
        pass
    user = next((u for u in data['users'] if u['id'] == session['user_id']), None)
    if not user:
        raise HTTPException(status_code=401, detail='User account not found')
    return user


class RegisterPayload(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class LoginPayload(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class BankCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class PeriodCreate(BaseModel):
    start_date: date


class TransactionCreate(BaseModel):
    bank_id: str
    type: Literal['income', 'expense']
    amount: float = Field(gt=0)
    category: str = Field(min_length=1, max_length=50)
    date: date
    note: Optional[str] = Field(default='', max_length=200)


def user_banks(data, user_id):
    return [b for b in data['banks'] if b.get('user_id') == user_id]


def user_periods(data, user_id):
    return sorted(
        [p for p in data['periods'] if p.get('user_id') == user_id],
        key=lambda p: p['start_date'],
        reverse=False,
    )


def period_end(periods, index):
    if index + 1 < len(periods):
        return (date.fromisoformat(periods[index + 1]['start_date']) - timedelta(days=1)).isoformat()
    return None


def period_view(periods, index):
    p = periods[index]
    start = date.fromisoformat(p['start_date'])
    end_value = period_end(periods, index)
    end = date.fromisoformat(end_value) if end_value else None
    label = f"{start.strftime('%d %b %Y')} – {end.strftime('%d %b %Y') if end else 'Current'}"
    return {**p, 'end_date': end_value, 'label': label}


def find_period(data, user_id, period_id):
    periods = user_periods(data, user_id)
    for index, period in enumerate(periods):
        if period['id'] == period_id:
            return period, period_view(periods, index), periods, index
    return None, None, periods, -1


def period_for_date(data, user_id, target_date: date):
    periods = user_periods(data, user_id)
    selected = None
    for p in periods:
        start = date.fromisoformat(p['start_date'])
        if start <= target_date:
            selected = p
        else:
            break
    return selected


def validate_email(email: str):
    email = email.strip().lower()
    if email.count('@') != 1 or '.' not in email.split('@', 1)[1] or ' ' in email:
        raise HTTPException(status_code=400, detail='Enter a valid email address')
    return email


def user_transactions(data, user_id):
    return [t for t in data['transactions'] if t.get('user_id') == user_id]


def aggregate(items):
    income = round(sum(float(x['amount']) for x in items if x['type'] == 'income'), 2)
    expense = round(sum(float(x['amount']) for x in items if x['type'] == 'expense'), 2)
    return {'income': income, 'expense': expense, 'savings': round(income - expense, 2), 'transaction_count': len(items)}


def period_transactions(data, user_id, period_id, bank_id=None):
    period, _, periods, _ = find_period(data, user_id, period_id)
    if not period:
        raise HTTPException(status_code=404, detail='Financial month not found')
    start = date.fromisoformat(period['start_date'])
    next_start = None
    for p in periods:
        if p['start_date'] > period['start_date']:
            next_start = date.fromisoformat(p['start_date'])
            break
    items = user_transactions(data, user_id)
    result = []
    for item in items:
        item_date = date.fromisoformat(item['date'])
        if item_date < start:
            continue
        if next_start and item_date >= next_start:
            continue
        if bank_id and item.get('bank_id') != bank_id:
            continue
        result.append(item)
    return result


@app.get('/')
def root():
    if FRONTEND_DIST.exists() and (FRONTEND_DIST / 'index.html').exists():
        return FileResponse(FRONTEND_DIST / 'index.html')
    return {'message': 'Daily Income & Expense Tracker API is running'}


@app.post('/auth/register')
def register(payload: RegisterPayload):
    data = load_data()
    email = validate_email(payload.email)
    if find_user_by_email(data, email):
        raise HTTPException(status_code=409, detail='An account with this email already exists')
    user_id = str(uuid.uuid4())
    salt, password_hash = hash_password(payload.password)
    user = {
        'id': user_id,
        'email': email,
        'password_salt': salt,
        'password_hash': password_hash,
        'created_at': now_iso(),
    }
    data['users'].append(user)
    migrate_orphaned_records_to_user(data, user_id)
    save_data(data)
    token = secrets.token_urlsafe(32)
    data = load_data()
    data['sessions'].append({
        'token': token,
        'user_id': user_id,
        'expires_at': (datetime.utcnow() + timedelta(days=TOKEN_DAYS)).isoformat() + 'Z',
    })
    save_data(data)
    return {'token': token, 'user': {'id': user_id, 'email': email}}


@app.post('/auth/login')
def login(payload: LoginPayload):
    data = load_data()
    email = validate_email(payload.email)
    user = find_user_by_email(data, email)
    if not user or not verify_password(payload.password, user['password_salt'], user['password_hash']):
        raise HTTPException(status_code=401, detail='Invalid email or password')
    token = secrets.token_urlsafe(32)
    data['sessions'] = [s for s in data['sessions'] if s.get('user_id') != user['id']]
    data['sessions'].append({
        'token': token,
        'user_id': user['id'],
        'expires_at': (datetime.utcnow() + timedelta(days=TOKEN_DAYS)).isoformat() + 'Z',
    })
    save_data(data)
    return {'token': token, 'user': {'id': user['id'], 'email': user['email']}}


@app.post('/auth/logout')
def logout(user=Depends(current_user), credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    data = load_data()
    token = credentials.credentials if credentials else ''
    data['sessions'] = [s for s in data['sessions'] if s.get('token') != token]
    save_data(data)
    return {'message': 'Logged out'}


@app.get('/auth/me')
def me(user=Depends(current_user)):
    return {'id': user['id'], 'email': user['email']}


@app.get('/banks')
def get_banks(user=Depends(current_user)):
    return sorted(user_banks(load_data(), user['id']), key=lambda b: b['created_at'])


@app.post('/banks')
def create_bank(payload: BankCreate, user=Depends(current_user)):
    data = load_data()
    name = payload.name.strip()
    if any(b['name'].lower() == name.lower() for b in user_banks(data, user['id'])):
        raise HTTPException(status_code=409, detail='A bank with this name already exists')
    bank = {'id': str(uuid.uuid4()), 'user_id': user['id'], 'name': name, 'created_at': now_iso()}
    data['banks'].append(bank)
    save_data(data)
    return bank


@app.delete('/banks/{bank_id}')
def delete_bank(bank_id: str, user=Depends(current_user)):
    data = load_data()
    if not any(b['id'] == bank_id and b.get('user_id') == user['id'] for b in data['banks']):
        raise HTTPException(status_code=404, detail='Bank not found')
    data['banks'] = [b for b in data['banks'] if not (b['id'] == bank_id and b.get('user_id') == user['id'])]
    data['transactions'] = [t for t in data['transactions'] if not (t.get('bank_id') == bank_id and t.get('user_id') == user['id'])]
    save_data(data)
    return {'message': 'Bank and its transactions deleted'}


@app.get('/periods')
def get_periods(user=Depends(current_user)):
    data = load_data()
    periods = user_periods(data, user['id'])
    return [period_view(periods, i) for i in range(len(periods) - 1, -1, -1)]


@app.post('/periods')
def create_period(payload: PeriodCreate, user=Depends(current_user)):
    data = load_data()
    periods = user_periods(data, user['id'])
    if any(p['start_date'] == payload.start_date.isoformat() for p in periods):
        raise HTTPException(status_code=409, detail='A financial month already starts on this date')
    if periods and payload.start_date <= date.fromisoformat(periods[-1]['start_date']):
        raise HTTPException(status_code=400, detail='New month start date must be after the current month start date')
    period = {
        'id': str(uuid.uuid4()),
        'user_id': user['id'],
        'start_date': payload.start_date.isoformat(),
        'created_at': now_iso(),
    }
    data['periods'].append(period)
    save_data(data)
    periods = user_periods(data, user['id'])
    index = next(i for i, p in enumerate(periods) if p['id'] == period['id'])
    return period_view(periods, index)


@app.get('/transactions')
def get_transactions(
    bank_id: Optional[str] = None,
    transaction_type: Optional[Literal['income', 'expense']] = None,
    period_id: Optional[str] = None,
    user=Depends(current_user),
):
    data = load_data()
    items = period_transactions(data, user['id'], period_id, bank_id) if period_id else user_transactions(data, user['id'])
    if bank_id and not any(b['id'] == bank_id and b.get('user_id') == user['id'] for b in data['banks']):
        raise HTTPException(status_code=404, detail='Bank not found')
    if transaction_type:
        items = [x for x in items if x['type'] == transaction_type]
    return sorted(items, key=lambda x: (x['date'], x['created_at']), reverse=True)


@app.post('/transactions')
def create_transaction(payload: TransactionCreate, user=Depends(current_user)):
    data = load_data()
    if not any(b['id'] == payload.bank_id and b.get('user_id') == user['id'] for b in data['banks']):
        raise HTTPException(status_code=404, detail='Bank not found')
    period = period_for_date(data, user['id'], payload.date)
    if not period:
        raise HTTPException(status_code=400, detail='Start a financial month before recording transactions for this date')
    item = {
        'id': str(uuid.uuid4()),
        'user_id': user['id'],
        **payload.model_dump(mode='json'),
        'created_at': now_iso(),
    }
    data['transactions'].append(item)
    save_data(data)
    return item


@app.delete('/transactions/{transaction_id}')
def delete_transaction(transaction_id: str, user=Depends(current_user)):
    data = load_data()
    if not any(x['id'] == transaction_id and x.get('user_id') == user['id'] for x in data['transactions']):
        raise HTTPException(status_code=404, detail='Transaction not found')
    data['transactions'] = [x for x in data['transactions'] if not (x['id'] == transaction_id and x.get('user_id') == user['id'])]
    save_data(data)
    return {'message': 'Transaction deleted'}


@app.get('/summary')
def get_summary(bank_id: Optional[str] = None, period_id: Optional[str] = None, user=Depends(current_user)):
    data = load_data()
    items = period_transactions(data, user['id'], period_id, bank_id) if period_id else user_transactions(data, user['id'])
    return aggregate(items)


@app.get('/monthly-summary')
def monthly_summary(bank_id: Optional[str] = None, user=Depends(current_user)):
    data = load_data()
    periods = user_periods(data, user['id'])
    result = []
    for index, period in enumerate(periods):
        items = period_transactions(data, user['id'], period['id'], bank_id)
        row = {'period_id': period['id'], **period_view(periods, index), **aggregate(items)}
        result.append(row)
    return list(reversed(result))


def percentage_change(current, previous):
    if previous == 0:
        return None if current == 0 else 100
    return round(((current - previous) / previous) * 100, 1)


@app.get('/dashboard')
def dashboard(user=Depends(current_user)):
    data = load_data()
    periods = user_periods(data, user['id'])
    if not periods:
        return {
            'current_period': None,
            'previous_period': None,
            'comparison': {'expense_change': 0, 'expense_change_pct': None, 'income_change': 0, 'income_change_pct': None},
            'total_savings': round(sum(float(t['amount']) if t['type'] == 'income' else -float(t['amount']) for t in user_transactions(data, user['id'])), 2),
        }
    current = periods[-1]
    current_index = len(periods) - 1
    current_view = period_view(periods, current_index)
    current_agg = aggregate(period_transactions(data, user['id'], current['id']))
    current_payload = {**current_view, **current_agg}
    previous_payload = None
    if len(periods) >= 2:
        previous = periods[-2]
        previous_view = period_view(periods, len(periods) - 2)
        previous_agg = aggregate(period_transactions(data, user['id'], previous['id']))
        previous_payload = {**previous_view, **previous_agg}
    prev_expense = previous_payload['expense'] if previous_payload else 0
    prev_income = previous_payload['income'] if previous_payload else 0
    return {
        'current_period': current_payload,
        'previous_period': previous_payload,
        'comparison': {
            'expense_change': round(current_payload['expense'] - prev_expense, 2),
            'expense_change_pct': percentage_change(current_payload['expense'], prev_expense),
            'income_change': round(current_payload['income'] - prev_income, 2),
            'income_change_pct': percentage_change(current_payload['income'], prev_income),
        },
        'total_savings': round(sum(float(t['amount']) if t['type'] == 'income' else -float(t['amount']) for t in user_transactions(data, user['id'])), 2),
    }


# Optional single-origin production hosting.
if FRONTEND_DIST.exists():
    app.mount('/assets', StaticFiles(directory=FRONTEND_DIST / 'assets'), name='assets')

    @app.get('/manifest.webmanifest')
    def pwa_manifest():
        return FileResponse(FRONTEND_DIST / 'manifest.webmanifest', media_type='application/manifest+json')

    @app.get('/sw.js')
    def pwa_service_worker():
        return FileResponse(FRONTEND_DIST / 'sw.js', media_type='application/javascript')

    @app.get('/icons/{icon_name}')
    def pwa_icon(icon_name: str):
        file = FRONTEND_DIST / 'icons' / icon_name
        if not file.exists():
            raise HTTPException(status_code=404, detail='Icon not found')
        return FileResponse(file)

    @app.get('/{path:path}')
    def serve_react_app(path: str):
        requested = FRONTEND_DIST / path
        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(FRONTEND_DIST / 'index.html')
