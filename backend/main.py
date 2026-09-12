from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import date, datetime
from pathlib import Path
import json
import uuid

app = FastAPI(title='Daily Income & Expense Tracker API')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173','http://127.0.0.1:5173','https://daily-income-expense-tracker-pwa.onrender.com/'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

DATA_DIR = Path(__file__).parent / 'data'
DATA_DIR.mkdir(exist_ok=True)
DATA_FILE = DATA_DIR / 'finance.json'
FRONTEND_DIST = Path(__file__).parent.parent / 'frontend' / 'dist'
if not DATA_FILE.exists():
    DATA_FILE.write_text(json.dumps({'banks': [], 'transactions': []}, indent=2), encoding='utf-8')

def load_data():
    try:
        data = json.loads(DATA_FILE.read_text(encoding='utf-8'))
        if isinstance(data, list):
            return {'banks': [], 'transactions': data}
        return data
    except (json.JSONDecodeError, FileNotFoundError):
        return {'banks': [], 'transactions': []}

def save_data(data):
    DATA_FILE.write_text(json.dumps(data, indent=2), encoding='utf-8')

class BankCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)

class TransactionCreate(BaseModel):
    bank_id: str
    type: Literal['income', 'expense']
    amount: float = Field(gt=0)
    category: str = Field(min_length=1, max_length=50)
    date: date
    note: Optional[str] = Field(default='', max_length=200)

@app.get('/')
def root():
    if FRONTEND_DIST.exists() and (FRONTEND_DIST / 'index.html').exists():
        return FileResponse(FRONTEND_DIST / 'index.html')
    return {'message': 'Daily Income & Expense Tracker API is running'}

@app.get('/banks')
def get_banks():
    return load_data()['banks']

@app.post('/banks')
def create_bank(payload: BankCreate):
    data = load_data()
    name = payload.name.strip()
    if any(b['name'].lower() == name.lower() for b in data['banks']):
        raise HTTPException(status_code=409, detail='A bank with this name already exists')
    bank = {'id': str(uuid.uuid4()), 'name': name, 'created_at': datetime.now().isoformat(timespec='seconds')}
    data['banks'].append(bank)
    save_data(data)
    return bank

@app.delete('/banks/{bank_id}')
def delete_bank(bank_id: str):
    data = load_data()
    if not any(b['id'] == bank_id for b in data['banks']):
        raise HTTPException(status_code=404, detail='Bank not found')
    data['banks'] = [b for b in data['banks'] if b['id'] != bank_id]
    data['transactions'] = [t for t in data['transactions'] if t['bank_id'] != bank_id]
    save_data(data)
    return {'message': 'Bank and its transactions deleted'}

@app.get('/transactions')
def get_transactions(bank_id: Optional[str] = None, transaction_type: Optional[Literal['income','expense']] = None, month: Optional[str] = None):
    items = load_data()['transactions']
    if bank_id: items = [x for x in items if x['bank_id'] == bank_id]
    if transaction_type: items = [x for x in items if x['type'] == transaction_type]
    if month: items = [x for x in items if x['date'][:7] == month]
    return sorted(items, key=lambda x: (x['date'], x['created_at']), reverse=True)

@app.post('/transactions')
def create_transaction(payload: TransactionCreate):
    data = load_data()
    if not any(b['id'] == payload.bank_id for b in data['banks']):
        raise HTTPException(status_code=404, detail='Bank not found')
    item = {'id': str(uuid.uuid4()), **payload.model_dump(mode='json'), 'created_at': datetime.now().isoformat(timespec='seconds')}
    data['transactions'].append(item)
    save_data(data)
    return item

@app.delete('/transactions/{transaction_id}')
def delete_transaction(transaction_id: str):
    data = load_data()
    new_items = [x for x in data['transactions'] if x['id'] != transaction_id]
    if len(new_items) == len(data['transactions']): raise HTTPException(status_code=404, detail='Transaction not found')
    data['transactions'] = new_items
    save_data(data)
    return {'message': 'Transaction deleted'}

@app.get('/summary')
def get_summary(bank_id: Optional[str] = None, month: Optional[str] = None):
    items = load_data()['transactions']
    if bank_id: items = [x for x in items if x['bank_id'] == bank_id]
    if month: items = [x for x in items if x['date'][:7] == month]
    income = sum(x['amount'] for x in items if x['type'] == 'income')
    expense = sum(x['amount'] for x in items if x['type'] == 'expense')
    return {'income': round(income,2), 'expense': round(expense,2), 'savings': round(income-expense,2), 'transaction_count': len(items)}

@app.get('/monthly-summary')
def monthly_summary(bank_id: Optional[str] = None):
    data = load_data()
    items = data['transactions']
    if bank_id: items = [x for x in items if x['bank_id'] == bank_id]
    grouped = {}
    for x in items:
        month = x['date'][:7]
        grouped.setdefault(month, {'month': month, 'income': 0, 'expense': 0})
        grouped[month][x['type']] += x['amount']
    result = []
    for month, row in grouped.items():
        row['savings'] = round(row['income'] - row['expense'], 2)
        row['income'] = round(row['income'], 2)
        row['expense'] = round(row['expense'], 2)
        result.append(row)
    return sorted(result, key=lambda x: x['month'], reverse=True)


# Optional single-origin production hosting:
# after `npm run build`, FastAPI can serve the React/PWA build from frontend/dist.
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
