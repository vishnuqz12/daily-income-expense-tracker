# Daily Money Tracker — Multi-user + Dashboard + Salary-day Months + PWA + Compressed CSV Storage + Self Transfer

This version keeps the existing bank tabs, separate Add Income/Add Expense actions, monthly history, savings calculations, multi-user login, dashboard, salary-day month workflow and iPhone PWA support.

## New in this version

- **Compressed CSV storage:** backend data is stored in `backend/data/finance_data.zip`. The ZIP contains CSV files for users, sessions, banks, transactions, financial periods and self transfers.
- **Legacy migration:** if the previous `finance.json` exists and the new ZIP does not, the app migrates the old data into the compressed CSV bundle on first use.
- **Self transfer:** move money from one of your bank accounts to another. Transfers do not count as income or expense and therefore do not change savings totals. They do change the displayed bank balance.
- **Automatic bank dropdown update:** when a new bank is added, it immediately becomes available as a transfer destination/source.
- **Personal backup:** the signed-in user can download a ZIP backup containing their own CSV files from the **Backup** button.

## Financial month behavior

A financial month starts only when the user chooses **Start New Month** and supplies a start date.

Example for salary on the 25th:

- 25 Sep 2026 → 24 Oct 2026
- 25 Oct 2026 → 24 Nov 2026
- 25 Nov 2026 → 24 Dec 2026

The application never resets the financial month automatically on the first day of a calendar month.

## Self transfer behavior

Example:

- From: ICICI Bank
- To: HDFC Bank
- Amount: ₹10,000

The transfer is recorded separately from income/expense. Overall savings stays unchanged, while the bank-balance calculation changes by -₹10,000 for ICICI and +₹10,000 for HDFC.

## Local development

### Backend

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

## Render deployment

### Backend Web Service

Root directory:

```text
backend
```

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

### Frontend Static Site

Root directory:

```text
frontend
```

Build command:

```bash
npm install && npm run build
```

Publish directory:

```text
dist
```

Set this frontend environment variable in Render:

```text
VITE_API_URL=https://YOUR-BACKEND.onrender.com
```

## Important storage limitation on Render Free

The compressed CSV bundle improves the storage format and makes backups easy, but it **does not make Render Free's filesystem persistent**. A Render instance can be replaced/restarted, and files stored only on its local filesystem can disappear.

For important financial records, keep the **Backup** download and move the storage layer to a persistent managed database such as PostgreSQL/Supabase when you are ready. The current user-facing behavior can remain the same when that storage layer is changed.

## iPhone PWA

The PWA manifest, service worker, mobile layout and iPhone Home Screen support remain included.

Open the HTTPS frontend in Safari → **Share → Add to Home Screen**.
