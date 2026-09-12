# Daily Income & Expense Tracker — Bank + Monthly + iPhone PWA

## Features
- Add multiple bank accounts; each bank is a separate tab.
- Separate Add Expense and Add Income actions for the selected bank.
- Record transactions by date, category and note.
- Select any month to view the expenses/income previously recorded for that month.
- Monthly Expense History shows every recorded month and its savings.
- Monthly savings = income - expense.
- NET TOTAL SAVINGS at the top = sum of savings across all recorded months for the selected bank.
- Responsive mobile layout with iPhone-friendly touch controls and safe-area spacing.
- Installable PWA with app manifest, service worker and iPhone Home Screen icon.
- API URL can be configured with `VITE_API_URL`; by default the frontend uses the current origin, which is convenient when the frontend and backend are hosted together.
- JSON storage; no database required.

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
Open the Vite URL, normally http://localhost:5173.

On an iPhone, the development server must be reachable from the phone over your local network; for normal PWA installation, use an HTTPS production deployment.

## Production / iPhone PWA
PWA installation on iPhone requires the production site to be served over HTTPS.

1. Build the frontend:
```bash
cd frontend
npm install
npm run build
```

2. Host the generated `frontend/dist` folder over HTTPS.

3. If the FastAPI backend is hosted at a different URL, create `frontend/.env` before the build:
```env
VITE_API_URL=https://your-api.example.com
```

4. Open the HTTPS frontend URL in Safari on the iPhone.

5. Tap **Share → Add to Home Screen → Add**.

The app icon and standalone PWA metadata are already included. The service worker caches the app shell and static assets so the installed shell can reopen even when the network is temporarily unavailable; financial API data still requires the backend to be reachable.
