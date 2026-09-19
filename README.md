# Daily Money Tracker — Local Excel PWA

This edition is fully local-first. There is **no FastAPI backend and no cloud database**. Each account is an Excel `.xlsx` workbook stored by the user on their own device.

## Included features
- Local account creation with email + password.
- One Excel workbook per person/account.
- Open an existing workbook and unlock it with its password.
- Bank tabs with separate income/expense tracking.
- Manual financial months based on a user-entered start date (for example, 25th to 24th).
- Dashboard with current vs previous financial month comparison.
- Net total savings across all banks and started months.
- Self bank-to-bank transfers that do not count as income or expense.
- Monthly history, transaction search, delete actions, bank balances.
- Excel Save / Export Copy.
- iPhone-ready PWA UI.
- Uses SheetJS in the browser to read and write XLSX files (npm package `xlsx`).

## Important local-file limitation
A normal web page cannot silently read arbitrary files from an iPhone's Files storage. On browsers without the File System Access API (including Safari in the current SheetJS compatibility guidance), the user must choose the Excel file again when opening the app. On supporting Chromium browsers, the app can remember an authorized file handle and auto-open the linked workbook when permission is still granted.

## Create an account
1. Open the app.
2. Select **Create account**.
3. Enter email and password.
4. The app creates `DailyMoneyTracker_<email>.xlsx` and saves/downloads it.
5. Keep the workbook in your Files/OneDrive/iCloud Drive as your source of truth.

## iPhone workflow
1. Open the PWA in Safari.
2. Create the account once and save the generated Excel workbook into the Files app.
3. Use **Open account → Choose Excel account** whenever Safari asks you to choose the workbook.
4. After making changes, tap **Save Excel**. Safari downloads an updated workbook; replace the previous copy in Files with the newest copy.

## Deployment on Render
Because there is no backend, deploy this project as a **single Render Static Site**:
- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`
- No environment variables are required.

You can also host the static `frontend` on other HTTPS static hosting providers.
