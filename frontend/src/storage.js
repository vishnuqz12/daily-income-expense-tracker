import * as XLSX from 'xlsx';

const DB_NAME = 'daily-money-tracker-indexeddb';
const DB_VERSION = 1;
const ACCOUNT_STORE = 'accounts';
const SESSION_STORE = 'session';
const CURRENT_SESSION_KEY = 'current';

export const APP_VERSION = '4.0.0-indexeddb';

export const emptyData = () => ({
  profile: null,
  banks: [],
  periods: [],
  transactions: [],
  transfers: [],
});

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      let accounts;
      if (!db.objectStoreNames.contains(ACCOUNT_STORE)) {
        accounts = db.createObjectStore(ACCOUNT_STORE, { keyPath: 'userId' });
        accounts.createIndex('email', 'email', { unique: true });
      } else {
        accounts = request.transaction.objectStore(ACCOUNT_STORE);
        if (!accounts.indexNames.contains('email')) {
          accounts.createIndex('email', 'email', { unique: true });
        }
      }

      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open IndexedDB.'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another browser tab. Close the other tab and try again.'));
  });
}

async function withStore(storeName, mode, operation) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);

    let result;

    try {
      result = operation(store, transaction);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('IndexedDB transaction failed.'));
    };

    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
    };
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function randomBytes(size = 16) {
  return crypto.getRandomValues(new Uint8Array(size));
}

function bytesToHex(bytes) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  return new Uint8Array((String(hex || '').match(/.{1,2}/g) || []).map((part) => parseInt(part, 16)));
}

async function hashPassword(password, saltBytes, iterations = 220000) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    key,
    256,
  );

  return bytesToHex(new Uint8Array(bits));
}

async function createVerifier(password) {
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);

  return {
    salt: bytesToHex(salt),
    hash,
  };
}

async function verifyPassword(password, account) {
  try {
    const hash = await hashPassword(password, hexToBytes(account.passwordSalt));
    return hash === account.passwordHash;
  } catch {
    return false;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateCredentials(email, password) {
  if (!email || !email.includes('@')) {
    throw new Error('Enter a valid email address.');
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
}

function sanitizeData(data) {
  return {
    profile: data.profile || null,
    banks: Array.isArray(data.banks) ? data.banks : [],
    periods: Array.isArray(data.periods) ? data.periods : [],
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    transfers: Array.isArray(data.transfers) ? data.transfers : [],
  };
}

function buildPublicData(account) {
  return sanitizeData(account.data || {
    ...emptyData(),
    profile: {
      userId: account.userId,
      email: account.email,
      createdAt: account.createdAt,
    },
  });
}

export async function createLocalAccount(email, password) {
  const normalizedEmail = normalizeEmail(email);
  validateCredentials(normalizedEmail, password);

  const existing = await getAccountByEmail(normalizedEmail);
  if (existing) {
    throw new Error('An account with this email already exists.');
  }

  const verifier = await createVerifier(password);
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();

  const data = {
    ...emptyData(),
    profile: {
      userId,
      email: normalizedEmail,
      createdAt: now,
    },
  };

  const account = {
    userId,
    email: normalizedEmail,
    passwordSalt: verifier.salt,
    passwordHash: verifier.hash,
    createdAt: now,
    data,
  };

  await withStore(ACCOUNT_STORE, 'readwrite', (store) => {
    store.add(account);
  });

  await setActiveSession(userId);

  return data;
}

async function getAccountByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ACCOUNT_STORE, 'readonly');
    const index = transaction.objectStore(ACCOUNT_STORE).index('email');
    const request = index.get(normalizedEmail);

    request.onsuccess = () => {
      const result = request.result || null;
      db.close();
      resolve(result);
    };

    request.onerror = () => {
      db.close();
      reject(request.error || new Error('Could not read the local account.'));
    };
  });
}

export async function loginLocalAccount(email, password) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    throw new Error('Enter your email and password.');
  }

  const account = await getAccountByEmail(normalizedEmail);

  if (!account || !(await verifyPassword(password, account))) {
    throw new Error('Invalid email or password.');
  }

  await setActiveSession(account.userId);

  return buildPublicData(account);
}

async function setActiveSession(userId) {
  await withStore(SESSION_STORE, 'readwrite', (store) => {
    store.put({
      key: CURRENT_SESSION_KEY,
      userId,
      savedAt: new Date().toISOString(),
    });
  });
}

async function getActiveSessionUserId() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readonly');
    const request = transaction.objectStore(SESSION_STORE).get(CURRENT_SESSION_KEY);

    request.onsuccess = () => {
      const result = request.result || null;
      db.close();
      resolve(result?.userId || null);
    };

    request.onerror = () => {
      db.close();
      reject(request.error || new Error('Could not read the local session.'));
    };
  });
}

export async function getActiveSessionData() {
  const userId = await getActiveSessionUserId();
  if (!userId) return null;

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ACCOUNT_STORE, 'readonly');
    const request = transaction.objectStore(ACCOUNT_STORE).get(userId);

    request.onsuccess = () => {
      const account = request.result || null;
      db.close();

      if (!account) {
        resolve(null);
        return;
      }

      resolve(buildPublicData(account));
    };

    request.onerror = () => {
      db.close();
      reject(request.error || new Error('Could not load the local account.'));
    };
  });
}

export async function saveUserData(data) {
  const userId = await getActiveSessionUserId();

  if (!userId) {
    throw new Error('Your local session has ended. Please log in again.');
  }

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ACCOUNT_STORE, 'readwrite');
    const store = transaction.objectStore(ACCOUNT_STORE);
    const request = store.get(userId);

    request.onsuccess = () => {
      const account = request.result;

      if (!account) {
        db.close();
        reject(new Error('Local account was not found.'));
        return;
      }

      const nextData = sanitizeData(data);
      nextData.profile = {
        ...(account.data?.profile || {}),
        ...(nextData.profile || {}),
        userId: account.userId,
        email: account.email,
      };

      store.put({
        ...account,
        data: nextData,
        updatedAt: new Date().toISOString(),
      });
    };

    request.onerror = () => {
      db.close();
      reject(request.error || new Error('Could not load your local account.'));
    };

    transaction.oncomplete = () => {
      db.close();
      resolve(true);
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('Could not save data to IndexedDB.'));
    };
  });
}

export async function clearActiveSession() {
  await withStore(SESSION_STORE, 'readwrite', (store) => {
    store.delete(CURRENT_SESSION_KEY);
  });
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // Browser may deny persistent-storage permission.
  }

  return false;
}

/* ---------------- Existing Excel export functionality ---------------- */

export function dataToWorkbook(data) {
  const wb = XLSX.utils.book_new();
  const profile = data.profile || {};

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        schema_version: APP_VERSION,
        email: profile.email || '',
        created_at: profile.createdAt || '',
        exported_at: new Date().toISOString(),
      },
    ]),
    'Profile',
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      data.banks.map((bank) => ({
        id: bank.id,
        name: bank.name,
        created_at: bank.createdAt,
      })),
    ),
    'Banks',
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      data.periods.map((period) => ({
        id: period.id,
        start_date: period.startDate,
        end_date: period.endDate || '',
        created_at: period.createdAt,
      })),
    ),
    'Periods',
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      data.transactions.map((transaction) => ({
        id: transaction.id,
        bank_id: transaction.bankId,
        period_id: transaction.periodId,
        type: transaction.type,
        amount: Number(transaction.amount),
        category: transaction.category,
        date: transaction.date,
        note: transaction.note || '',
        created_at: transaction.createdAt,
      })),
    ),
    'Transactions',
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      data.transfers.map((transfer) => ({
        id: transfer.id,
        from_bank_id: transfer.fromBankId,
        to_bank_id: transfer.toBankId,
        period_id: transfer.periodId,
        amount: Number(transfer.amount),
        date: transfer.date,
        note: transfer.note || '',
        created_at: transfer.createdAt,
      })),
    ),
    'Transfers',
  );

  return wb;
}

export async function exportWorkbook(data, preferredName = 'DailyMoneyTracker.xlsx') {
  const wb = dataToWorkbook(data);
  XLSX.writeFile(wb, preferredName);
  return true;
}

export function makeWorkbookFileName(email) {
  const safe = String(email || 'account')
    .split('@')[0]
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'account';

  return `DailyMoneyTracker_${safe}.xlsx`;
}
