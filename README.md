# Daily Money Tracker — IndexedDB PWA

Local-first personal finance tracker built with React, Vite and IndexedDB.

## Storage
- IndexedDB is the live local database.
- Multiple local accounts are supported.
- Each account stores its own banks, financial months, transactions and transfers.
- The app requests persistent browser storage where supported.
- Excel export remains available as a backup copy.

## Existing features retained
- Login and account creation.
- Bank tabs.
- Income and expense tracking.
- Salary-cycle financial months started manually.
- Dashboard with current vs previous financial month.
- Monthly history.
- Self bank transfers.
- Bank balances and total savings.
- iPhone-ready PWA.

## Local development
```bash
cd frontend
npm install
npm run dev
```

## Production build
```bash
cd frontend
npm install
npm run build
```

## Deploy on Render
Create a **Static Site** connected to the GitHub repository.

- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

No FastAPI service, PostgreSQL database, Google Apps Script URL, or environment variable is required.

## Data behavior
IndexedDB is stored separately per browser/device. Redeploying the static website does not intentionally clear a user's IndexedDB data, but clearing browser/site data or moving to another device does not transfer the local database.

Use **Export Excel** regularly as a backup.
