import * as XLSX from 'xlsx';

const DB_NAME = 'daily-money-tracker-local';
const STORE_NAME = 'files';
const HANDLE_KEY = 'active-workbook-handle';

export const APP_VERSION = '3.0.0-local-excel';
export const WORKBOOK_SHEETS = ['Profile', 'Banks', 'Periods', 'Transactions', 'Transfers'];

export const emptyData = () => ({
  profile: null,
  banks: [],
  periods: [],
  transactions: [],
  transfers: [],
});

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return resolve(null);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveFileHandle(handle) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getFileHandle() {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export function supportsFileSystemAccess() {
  return typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
}

async function ensurePermission(handle, mode = 'read') {
  if (!handle) return false;
  const options = { mode };
  if (typeof handle.queryPermission === 'function') {
    const current = await handle.queryPermission(options);
    if (current === 'granted') return true;
  }
  if (typeof handle.requestPermission === 'function') {
    const next = await handle.requestPermission(options);
    return next === 'granted';
  }
  return true;
}

function normalizeRows(sheet, expected) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map((row) => {
    const out = {};
    for (const key of expected) out[key] = row[key] === undefined ? '' : row[key];
    return out;
  });
}

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanDate(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function dataToWorkbook(data) {
  const wb = XLSX.utils.book_new();
  const profile = data.profile || {};
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    schema_version: APP_VERSION,
    email: profile.email || '',
    password_salt: profile.passwordSalt || '',
    password_hash: profile.passwordHash || '',
    created_at: profile.createdAt || '',
    updated_at: new Date().toISOString(),
  }]), 'Profile');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.banks.map((b) => ({
    id: b.id, name: b.name, created_at: b.createdAt,
  }))), 'Banks');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.periods.map((p) => ({
    id: p.id, start_date: p.startDate, created_at: p.createdAt,
  }))), 'Periods');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.transactions.map((t) => ({
    id: t.id, bank_id: t.bankId, period_id: t.periodId, type: t.type,
    amount: Number(t.amount), category: t.category, date: t.date, note: t.note || '', created_at: t.createdAt,
  }))), 'Transactions');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.transfers.map((t) => ({
    id: t.id, from_bank_id: t.fromBankId, to_bank_id: t.toBankId, period_id: t.periodId,
    amount: Number(t.amount), date: t.date, note: t.note || '', created_at: t.createdAt,
  }))), 'Transfers');

  return wb;
}

export function workbookToData(wb) {
  if (!wb.SheetNames.includes('Profile')) throw new Error('This is not a Daily Money Tracker Excel file.');
  const profileRows = normalizeRows(wb.Sheets.Profile, ['schema_version','email','password_salt','password_hash','created_at','updated_at']);
  const profile = profileRows[0];
  if (!profile?.email || !profile?.password_salt || !profile?.password_hash) throw new Error('The Excel file is missing required account information.');

  const banks = wb.Sheets.Banks ? normalizeRows(wb.Sheets.Banks, ['id','name','created_at']).filter((b) => b.id && b.name).map((b) => ({ id: String(b.id), name: String(b.name), createdAt: String(b.created_at || '') })) : [];
  const periods = wb.Sheets.Periods ? normalizeRows(wb.Sheets.Periods, ['id','start_date','created_at']).filter((p) => p.id && p.start_date).map((p) => ({ id: String(p.id), startDate: cleanDate(p.start_date), createdAt: String(p.created_at || '') })) : [];
  const transactions = wb.Sheets.Transactions ? normalizeRows(wb.Sheets.Transactions, ['id','bank_id','period_id','type','amount','category','date','note','created_at']).filter((t) => t.id && t.bank_id && t.period_id).map((t) => ({
    id: String(t.id), bankId: String(t.bank_id), periodId: String(t.period_id), type: t.type === 'income' ? 'income' : 'expense',
    amount: cleanNumber(t.amount), category: String(t.category || 'Other'), date: cleanDate(t.date), note: String(t.note || ''), createdAt: String(t.created_at || ''),
  })) : [];
  const transfers = wb.Sheets.Transfers ? normalizeRows(wb.Sheets.Transfers, ['id','from_bank_id','to_bank_id','period_id','amount','date','note','created_at']).filter((t) => t.id && t.from_bank_id && t.to_bank_id && t.period_id).map((t) => ({
    id: String(t.id), fromBankId: String(t.from_bank_id), toBankId: String(t.to_bank_id), periodId: String(t.period_id),
    amount: cleanNumber(t.amount), date: cleanDate(t.date), note: String(t.note || ''), createdAt: String(t.created_at || ''),
  })) : [];

  return {
    profile: {
      email: String(profile.email).trim().toLowerCase(),
      passwordSalt: String(profile.password_salt),
      passwordHash: String(profile.password_hash),
      createdAt: String(profile.created_at || ''),
    }, banks, periods, transactions, transfers,
  };
}

export async function readWorkbookFile(file) {
  const data = await file.arrayBuffer();
  return workbookToData(XLSX.read(data, { type: 'array', cellDates: false }));
}

export async function openWorkbookPicker() {
  if (supportsFileSystemAccess()) {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'Excel workbook',
        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
      }],
      excludeAcceptAllOption: true,
    });
    const file = await handle.getFile();
    const data = await readWorkbookFile(file);
    await saveFileHandle(handle);
    return { data, handle, source: 'filesystem' };
  }

  throw new Error('FILE_INPUT_REQUIRED');
}

export async function openHandleIfAvailable() {
  if (!supportsFileSystemAccess()) return null;
  const handle = await getFileHandle();
  if (!handle) return null;
  try {
    if (!(await ensurePermission(handle, 'read'))) return null;
    const file = await handle.getFile();
    const data = await readWorkbookFile(file);
    return { data, handle, source: 'filesystem' };
  } catch {
    return null;
  }
}

export async function saveWorkbook(data, preferredName = 'DailyMoneyTracker.xlsx', existingHandle = null) {
  const wb = dataToWorkbook(data);
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  if (existingHandle && supportsFileSystemAccess()) {
    const allowed = await ensurePermission(existingHandle, 'readwrite');
    if (allowed) {
      const writable = await existingHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      await saveFileHandle(existingHandle);
      return { mode: 'saved', handle: existingHandle, blob };
    }
  }

  if (supportsFileSystemAccess()) {
    const handle = await window.showSaveFilePicker({
      suggestedName: preferredName,
      types: [{
        description: 'Excel workbook',
        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
      }],
      excludeAcceptAllOption: true,
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    await saveFileHandle(handle);
    return { mode: 'saved', handle, blob };
  }

  XLSX.writeFile(wb, preferredName);
  return { mode: 'downloaded', handle: null, blob };
}

export function makeWorkbookFileName(email) {
  const safe = String(email || 'account').split('@')[0].replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'account';
  return `DailyMoneyTracker_${safe}.xlsx`;
}
