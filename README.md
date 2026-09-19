# Daily Money Tracker — PostgreSQL Edition

A mobile-first React PWA with a FastAPI backend and PostgreSQL persistence.

## What is included

- Multi-user accounts with email/password login.
- Per-user bank accounts, financial months, income, expenses, transfers and savings.
- Financial months start only when the user explicitly chooses a date (for example the 25th for a salary cycle).
- Dashboard comparing the two most recent financial months.
- Self transfer between the user's own bank accounts. Transfers do not count as income or expenses.
- iPhone PWA manifest, icons and service worker.
- PostgreSQL storage with foreign keys, indexes, decimal money columns and connection pooling.
- Passwords are stored as PBKDF2 hashes; session tokens are stored as SHA-256 hashes.
- User backup export as a ZIP containing CSV files.
- Legacy JSON / compressed-CSV storage migration when a compatible local file is present.

## Production architecture

```text
iPhone / Browser
      |
      v
Render Static Site (React PWA)
      |
      | HTTPS / REST API
      v
Render Web Service (FastAPI)
      |
      | PostgreSQL connection
      v
Supabase PostgreSQL (Free plan)
```

## Local development

Create a virtual environment and install the backend requirements. Set `DATABASE_URL` to a PostgreSQL database. `DB_SSLMODE=prefer` is suitable for a local PostgreSQL instance; `require` is recommended for hosted databases.

Run the backend from the `backend` folder:

```bash
uvicorn main:app --reload --port 8000
```

Run the frontend from `frontend` using your existing Vite workflow.

## Supabase setup

1. Create a Supabase project.
2. Open **Connect** and copy the **Session pooler** PostgreSQL connection string. The shared pooler is IPv4-compatible and uses port `5432` in session mode.
3. Replace `[YOUR-PASSWORD]` with the database password. Keep the connection string secret.
4. In Render, open the FastAPI service → **Environment** and add:

```text
DATABASE_URL=<your Supabase session-pooler connection string>
CORS_ORIGINS=https://YOUR-FRONTEND.onrender.com
DB_SSLMODE=require
```

5. Deploy the backend. Tables are created automatically on startup.

## Render settings

### Backend Web Service

```text
Root Directory: backend
Build Command: pip install -r requirements.txt
Start Command: uvicorn main:app --host 0.0.0.0 --port $PORT
Health Check Path: /health
```

### Frontend Static Site

```text
Root Directory: frontend
Build Command: npm install && npm run build
Publish Directory: dist
```

Frontend environment variable:

```text
VITE_API_URL=https://YOUR-BACKEND.onrender.com
```

## Migrating an old CSV backup

Before replacing the old Render backend, use the old app's **Backup** button and save the ZIP locally.

Create the destination user in the new PostgreSQL-backed app first. Then from the `backend` directory, set `DATABASE_URL` to your Supabase connection string and run:

```bash
python scripts/import_backup.py path/to/your-backup.zip --email you@example.com
```

Passwords are not imported from the backup. The destination account keeps its new password. The backup's banks, periods, transactions and transfers are imported into that account.

## Data persistence note

PostgreSQL fixes the main problem with Render's local file storage: transactions are no longer dependent on the web service's local filesystem. Supabase's current Free plan includes a Postgres database with a 500 MB database quota, but Free projects can be paused after 1 week of inactivity and the plan does not include automatic database backups. Keep the in-app CSV backup as an additional safety copy.
