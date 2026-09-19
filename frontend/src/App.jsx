import { useEffect, useMemo, useRef, useState } from 'react';
import {
  APP_VERSION,
  emptyData,
  getFileHandle,
  makeWorkbookFileName,
  openHandleIfAvailable,
  readWorkbookFile,
  saveFileHandle,
  saveWorkbook,
} from './storage';

const incomeCategories = ['Salary', 'Freelance', 'Business', 'Interest', 'Other'];
const expenseCategories = ['Food', 'Travel', 'Shopping', 'Bills', 'Rent', 'Health', 'Entertainment', 'EMI', 'Other'];

const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const dateLabel = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const clampDay = (year, monthIndex, day) => Math.min(day, new Date(year, monthIndex + 1, 0).getDate());
const addMonths = (dateStr, count) => {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + count, 1);
  target.setDate(clampDay(target.getFullYear(), target.getMonth(), day));
  return target.toISOString().slice(0, 10);
};
const subDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10);
};
const periodEnd = (startDate) => subDays(addMonths(startDate, 1), 1);
const periodLabel = (period) => period ? `${dateLabel(period.startDate)} – ${dateLabel(period.endDate || periodEnd(period.startDate))}` : 'No month started';
const isDateWithinPeriod = (date, period) => period && date >= period.startDate && date <= (period.endDate || periodEnd(period.startDate));

async function bytesToHash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const randomBytes = (size) => crypto.getRandomValues(new Uint8Array(size));

async function hashPassword(password, saltBytes, iterations = 220000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256);
  return bytesToHash(new Uint8Array(bits));
}

async function createVerifier(password) {
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  return { salt: [...salt].map((b) => b.toString(16).padStart(2, '0')).join(''), hash };
}

const hexToBytes = (hex) => new Uint8Array((hex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));

async function verifyPassword(password, profile) {
  try { return (await hashPassword(password, hexToBytes(profile.passwordSalt))) === profile.passwordHash; }
  catch { return false; }
}

function makeInitialForm(type, period) {
  const date = period && isDateWithinPeriod(today(), period) ? today() : (period?.startDate || today());
  return { amount: '', category: type === 'expense' ? 'Food' : 'Salary', date, note: '' };
}

function LoginScreen({ onOpenFile, onCreateAccount, autoLoading, error }) {
  const inputRef = useRef(null);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('open');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  async function handleOpenFile(file) {
    if (!file) return;
    setBusy(true); setLocalError('');
    try { const data = await readWorkbookFile(file); setPassword(''); await onOpenFile(data, null, file.name); }
    catch (err) { setLocalError(err.message || 'Could not open the Excel account.'); }
    finally { setBusy(false); }
  }

  async function handleCreate(e) {
    e.preventDefault(); setLocalError('');
    if (newPassword.length < 8) return setLocalError('Password must be at least 8 characters.');
    if (newPassword !== confirm) return setLocalError('Passwords do not match.');
    setBusy(true);
    try { await onCreateAccount(email.trim(), newPassword); }
    catch (err) { setLocalError(err.message || 'Could not create the account.'); }
    finally { setBusy(false); }
  }

  const shownError = localError || error;
  return <div className="auth-shell">
    <div className="auth-card">
      <div className="brand-mark">₹</div>
      <div className="eyebrow">PRIVATE • LOCAL EXCEL</div>
      <h1>Daily Money Tracker</h1>
      <p className="auth-subtitle">Your account and financial records live in your own Excel workbook on your device.</p>
      <div className="auth-switch">
        <button className={mode === 'open' ? 'active' : ''} onClick={() => { setMode('open'); setLocalError(''); }}>Open account</button>
        <button className={mode === 'create' ? 'active' : ''} onClick={() => { setMode('create'); setLocalError(''); }}>Create account</button>
      </div>
      {shownError && <div className="error">{shownError}</div>}

      {mode === 'open' ? <>
        <button className="primary-button large" onClick={() => inputRef.current?.click()} disabled={busy || autoLoading}>{busy || autoLoading ? 'Opening Excel…' : 'Choose Excel account'}</button>
        <input ref={inputRef} className="hidden-file" type="file" accept=".xlsx,.xls" onChange={(e) => handleOpenFile(e.target.files?.[0])} />
        <div className="auth-help"><strong>How it works</strong><span>Choose your DailyMoneyTracker Excel file. Your profile appears first, then enter the workbook password to unlock the data.</span></div>
        <div className="security-note">No backend • No cloud database • No server copy of your financial data.</div>
      </> : <form onSubmit={handleCreate}>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
        <label>Password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required /></label>
        <label>Confirm password<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" required /></label>
        <button className="primary-button large" disabled={busy}>{busy ? 'Creating Excel account…' : 'Create account & Excel file'}</button>
        <p className="auth-note">Your password is stored as a salted hash inside the workbook, not as plain text.</p>
      </form>}
      <div className="version-note">Local Excel edition • {APP_VERSION}</div>
    </div>
  </div>;
}

function PasswordDialog({ profile, onUnlock, onCancel }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    const ok = await verifyPassword(password, profile);
    if (!ok) setError('Incorrect password for this Excel account.'); else onUnlock();
    setBusy(false);
  }
  return <div className="modal-backdrop"><div className="modal-card">
    <div className="eyebrow">ACCOUNT</div><h2>{profile.email}</h2><p className="muted">Enter the password stored for this local Excel account.</p>
    {error && <div className="error">{error}</div>}
    <form onSubmit={submit}><label>Password<input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button></div>
    </form>
  </div></div>;
}

function Dashboard({ data }) {
  const periods = [...data.periods].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const current = periods[0]; const previous = periods[1];
  const totalSavings = data.transactions.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
  const stats = (period) => {
    if (!period) return { income: 0, expense: 0, savings: 0 };
    const transactions = data.transactions.filter((t) => t.periodId === period.id);
    const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, savings: income - expense };
  };
  const c = stats(current), p = stats(previous);
  const delta = (a, b) => ({ amount: a - b, pct: b ? ((a - b) / Math.abs(b)) * 100 : null });
  const max = Math.max(c.income, p.income, c.expense, p.expense, 1);
  const bar = (v) => `${Math.max(3, Math.round((v / max) * 100))}%`;
  return <div className="dashboard-wrap">
    <section className="dashboard-hero panel"><div><div className="eyebrow">DASHBOARD</div><h2>Financial overview</h2><p>Comparison uses your manually started salary-cycle months. Nothing resets on the 1st unless you start a new month.</p></div><div className="dashboard-total"><span>NET TOTAL SAVINGS</span><strong>{money(totalSavings)}</strong><small>All banks • all started months</small></div></section>
    <section className="comparison-grid">
      {['Income', 'Expense', 'Savings'].map((label) => {
        const key = label.toLowerCase(); const cd = delta(c[key], p[key]);
        return <div className="comparison-card panel" key={label}><div className="card-top"><span>{label}</span><span>{current ? 'Current vs previous' : '—'}</span></div>
          <div className="compare-values"><div><small>Current</small><strong>{money(c[key])}</strong></div><div><small>Previous</small><strong>{previous ? money(p[key]) : '—'}</strong></div></div>
          <div className="delta">{previous ? `${cd.amount >= 0 ? '+' : ''}${money(cd.amount)}${cd.pct == null ? '' : ` (${cd.pct >= 0 ? '+' : ''}${cd.pct.toFixed(1)}%)`}` : 'Start a second month to compare'}</div>
        </div>;
      })}
    </section>
    <section className="panel chart-panel"><div className="section-title"><div><h3>{current ? periodLabel(current) : 'No month started'}</h3><p>Income and expense side by side</p></div></div>
      {current ? <div className="bar-chart"><div className="bar-group"><span>Current income</span><div className="bar-track"><div className="bar income-bar" style={{ width: bar(c.income) }} /></div><strong>{money(c.income)}</strong></div><div className="bar-group"><span>Previous income</span><div className="bar-track"><div className="bar previous-bar" style={{ width: previous ? bar(p.income) : '3%' }} /></div><strong>{previous ? money(p.income) : '—'}</strong></div><div className="bar-group"><span>Current expense</span><div className="bar-track"><div className="bar expense-bar" style={{ width: bar(c.expense) }} /></div><strong>{money(c.expense)}</strong></div><div className="bar-group"><span>Previous expense</span><div className="bar-track"><div className="bar expense-previous-bar" style={{ width: previous ? bar(p.expense) : '3%' }} /></div><strong>{previous ? money(p.expense) : '—'}</strong></div></div> : <div className="empty"><strong>Start your first financial month</strong><span>Use Start New Month from the Accounts tab.</span></div>}
    </section>
  </div>;
}

function ProfileMenu({ email, onLogout, onSave, onOpen, onBackup }) {
  return <div className="profile-actions"><div className="profile-pill"><div className="avatar">{email[0]?.toUpperCase() || 'U'}</div><div><strong>{email}</strong><span>Local Excel account</span></div></div><button className="secondary-button" onClick={onSave}>Save Excel</button><button className="secondary-button" onClick={onOpen}>Open Excel</button><button className="secondary-button" onClick={onBackup}>Export copy</button><button className="danger-button" onClick={onLogout}>Logout</button></div>;
}

function App() {
  const [data, setData] = useState(emptyData());
  const [unlocked, setUnlocked] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(null);
  const [currentHandle, setCurrentHandle] = useState(null);
  const [fileName, setFileName] = useState('');
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('dashboard');
  const [bankId, setBankId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [type, setType] = useState('expense');
  const [form, setForm] = useState(makeInitialForm('expense', null));
  const [bankName, setBankName] = useState('');
  const [newStartDate, setNewStartDate] = useState(today());
  const [showBankForm, setShowBankForm] = useState(false);
  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromBankId: '', toBankId: '', amount: '', date: today(), note: '' });
  const [filter, setFilter] = useState('');
  const [showAllMonths, setShowAllMonths] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const restored = await openHandleIfAvailable();
        if (restored) {
          setData(restored.data); setCurrentHandle(restored.handle); setFileName(restored.handle.name); setPendingOpen(restored.data); setNotice(`Found ${restored.handle.name}. Enter its password to continue.`);
        }
      } finally { setBooting(false); }
    })();
  }, []);

  const sortedPeriods = useMemo(() => [...data.periods].sort((a, b) => b.startDate.localeCompare(a.startDate)), [data.periods]);
  const activePeriod = sortedPeriods.find((p) => p.id === periodId) || sortedPeriods[0];
  const sortedBanks = useMemo(() => [...data.banks].sort((a, b) => a.name.localeCompare(b.name)), [data.banks]);
  const activeBank = sortedBanks.find((b) => b.id === bankId) || sortedBanks[0];

  useEffect(() => {
    if (!unlocked) return;
    if (!bankId && sortedBanks[0]) setBankId(sortedBanks[0].id);
    if (!periodId && sortedPeriods[0]) setPeriodId(sortedPeriods[0].id);
  }, [unlocked, sortedBanks, sortedPeriods, bankId, periodId]);

  useEffect(() => {
    if (activePeriod) setForm(makeInitialForm(type, activePeriod));
  }, [activePeriod?.id]);

  useEffect(() => {
    if (activePeriod) setTransferForm((f) => ({ ...f, date: isDateWithinPeriod(f.date, activePeriod) ? f.date : activePeriod.startDate }));
  }, [activePeriod?.id]);

  function clearMessages() { setError(''); setNotice(''); }

  async function createAccount(email, password) {
    const verifier = await createVerifier(password);
    const next = { ...emptyData(), profile: { email: email.toLowerCase(), passwordSalt: verifier.salt, passwordHash: verifier.hash, createdAt: new Date().toISOString() } };
    const result = await saveWorkbook(next, makeWorkbookFileName(email));
    setData(next); setUnlocked(true); setCurrentHandle(result.handle); setFileName(makeWorkbookFileName(email)); setBankId(''); setPeriodId(''); setTab('dashboard'); setNotice(result.mode === 'downloaded' ? 'Excel account created and downloaded. Keep this file safely in your Files app.' : 'Excel account created and saved.');
  }

  async function openAccountFromData(nextData, handle, name) {
    if (!nextData.profile?.email) throw new Error('Invalid account workbook.');
    setPendingOpen({ data: nextData, handle, name }); setNotice(`Account found: ${nextData.profile.email}`); setError('');
  }

  function unlockPending() {
    if (!pendingOpen) return;
    const next = pendingOpen.data || pendingOpen;
    setData(next); setCurrentHandle(pendingOpen.handle || null); setFileName(pendingOpen.handle?.name || pendingOpen.name || 'Daily Money Tracker.xlsx'); setUnlocked(true); setPendingOpen(null); setTab('dashboard'); setError(''); setNotice(`Welcome back, ${next.profile.email}.`);
  }

  function handleLogout() { setUnlocked(false); setPendingOpen(null); setData(emptyData()); setCurrentHandle(null); setFileName(''); setBankId(''); setPeriodId(''); setNotice(''); setError(''); }

  async function openExisting() {
    clearMessages();
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }], excludeAcceptAllOption: true });
        const file = await handle.getFile(); const next = await readWorkbookFile(file); await saveFileHandle(handle); openAccountFromData(next, handle, file.name);
      } catch (err) { if (err?.name !== 'AbortError') setError(err.message || 'Could not open the Excel file.'); }
    } else fileInputRef.current?.click();
  }

  async function handleFallbackOpen(file) {
    if (!file) return;
    try { const next = await readWorkbookFile(file); await openAccountFromData(next, null, file.name); }
    catch (err) { setError(err.message || 'Could not open the Excel file.'); }
  }

  async function saveCurrent(downloadCopy = false) {
    if (!unlocked || !data.profile) return;
    clearMessages();
    try {
      const result = await saveWorkbook(data, makeWorkbookFileName(data.profile.email), downloadCopy ? null : currentHandle);
      setCurrentHandle(result.handle || currentHandle); setFileName(result.handle?.name || fileName || makeWorkbookFileName(data.profile.email));
      setNotice(result.mode === 'downloaded' ? 'Excel copy downloaded. On iPhone/iPad, replace your old file in Files with this updated copy.' : 'Saved to your Excel workbook.');
    } catch (err) { if (err?.name !== 'AbortError') setError(err.message || 'Could not save the Excel workbook.'); }
  }

  const persist = async (next, message = 'Changes saved to this session. Click Save Excel to write the workbook on iPhone.') => {
    setData(next);
    if (currentHandle && typeof currentHandle.createWritable === 'function') {
      try { const result = await saveWorkbook(next, makeWorkbookFileName(next.profile.email), currentHandle); setCurrentHandle(result.handle || currentHandle); setNotice('Changes saved automatically to your Excel workbook.'); } catch { setNotice(message); }
    } else setNotice(message);
  };

  async function addBank(e) {
    e.preventDefault(); clearMessages(); const name = bankName.trim(); if (!name) return setError('Enter a bank name.');
    if (data.banks.some((b) => b.name.toLowerCase() === name.toLowerCase())) return setError('That bank already exists.');
    const bank = { id: uid('bank'), name, createdAt: new Date().toISOString() };
    const next = { ...data, banks: [...data.banks, bank] }; setBankName(''); setShowBankForm(false); setBankId(bank.id); setTransferForm((f) => ({ ...f, fromBankId: bank.id, toBankId: data.banks[0]?.id || '' })); await persist(next, 'Bank added. Click Save Excel to keep it in the file.');
  }

  async function removeBank() {
    if (!activeBank) return; if (!window.confirm(`Delete ${activeBank.name} and its related transactions and transfers?`)) return;
    const next = { ...data,
      banks: data.banks.filter((b) => b.id !== activeBank.id),
      transactions: data.transactions.filter((t) => t.bankId !== activeBank.id),
      transfers: data.transfers.filter((t) => t.fromBankId !== activeBank.id && t.toBankId !== activeBank.id),
    };
    setBankId(next.banks[0]?.id || ''); await persist(next, 'Bank deleted. Save Excel to write the change.');
  }

  async function addPeriod(e) {
    e.preventDefault(); clearMessages();
    const startDate = newStartDate; if (!startDate) return setError('Choose a start date.');
    if (data.periods.some((p) => p.startDate === startDate)) return setError('A financial month with this start date already exists.');
    const period = { id: uid('period'), startDate, endDate: periodEnd(startDate), createdAt: new Date().toISOString() };
    const next = { ...data, periods: [...data.periods, period] }; setNewStartDate(today()); setShowPeriodForm(false); setPeriodId(period.id); setForm(makeInitialForm(type, period)); setTransferForm((f) => ({ ...f, date: period.startDate })); await persist(next, 'Financial month started. Save Excel to write the change.');
  }

  async function addTransaction(e) {
    e.preventDefault(); clearMessages();
    if (!activeBank) return setError('Add a bank account first.');
    if (!activePeriod) return setError('Start a financial month before adding transactions.');
    const amount = Number(form.amount); if (!(amount > 0)) return setError('Enter an amount greater than 0.');
    if (!isDateWithinPeriod(form.date, activePeriod)) return setError(`Date must be between ${dateLabel(activePeriod.startDate)} and ${dateLabel(activePeriod.endDate || periodEnd(activePeriod.startDate))}.`);
    const transaction = { id: uid('txn'), bankId: activeBank.id, periodId: activePeriod.id, type, amount: Math.round(amount * 100) / 100, category: form.category, date: form.date, note: form.note.trim(), createdAt: new Date().toISOString() };
    const next = { ...data, transactions: [transaction, ...data.transactions] }; setForm(makeInitialForm(type, activePeriod)); await persist(next, 'Transaction added. Save Excel to write the change.');
  }

  async function addTransfer(e) {
    e.preventDefault(); clearMessages(); if (!activePeriod) return setError('Start a financial month before transferring money.');
    const amount = Number(transferForm.amount); if (!transferForm.fromBankId || !transferForm.toBankId) return setError('Choose both banks.');
    if (transferForm.fromBankId === transferForm.toBankId) return setError('Choose two different banks.');
    if (!(amount > 0)) return setError('Enter a transfer amount greater than 0.');
    if (!isDateWithinPeriod(transferForm.date, activePeriod)) return setError('Transfer date must be inside the selected financial month.');
    const transfer = { id: uid('transfer'), fromBankId: transferForm.fromBankId, toBankId: transferForm.toBankId, periodId: activePeriod.id, amount: Math.round(amount * 100) / 100, date: transferForm.date, note: transferForm.note.trim(), createdAt: new Date().toISOString() };
    const next = { ...data, transfers: [transfer, ...data.transfers] }; setTransferForm((f) => ({ ...f, amount: '', note: '' })); setShowTransferForm(false); await persist(next, 'Bank transfer recorded. Save Excel to write the change.');
  }

  async function deleteItem(kind, id) {
    clearMessages();
    const next = kind === 'transaction' ? { ...data, transactions: data.transactions.filter((t) => t.id !== id) } : { ...data, transfers: data.transfers.filter((t) => t.id !== id) };
    await persist(next, 'Item deleted. Save Excel to write the change.');
  }

  const selectedBankTransactions = useMemo(() => {
    return data.transactions.filter((t) => t.bankId === activeBank?.id && t.periodId === activePeriod?.id).filter((t) => !filter || t.category.toLowerCase().includes(filter.toLowerCase()) || t.note.toLowerCase().includes(filter.toLowerCase()) || t.type.includes(filter.toLowerCase()));
  }, [data.transactions, activeBank?.id, activePeriod?.id, filter]);
  const selectedTransfers = useMemo(() => data.transfers.filter((t) => t.periodId === activePeriod?.id && (t.fromBankId === activeBank?.id || t.toBankId === activeBank?.id)), [data.transfers, activePeriod?.id, activeBank?.id]);

  const summary = useMemo(() => {
    if (!activeBank || !activePeriod) return { income: 0, expense: 0, savings: 0, balance: 0 };
    const transactions = data.transactions.filter((t) => t.bankId === activeBank.id && t.periodId === activePeriod.id);
    const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balanceTransactions = data.transactions.filter((t) => t.bankId === activeBank.id).reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    const transferBalance = data.transfers.reduce((s, t) => s + (t.toBankId === activeBank.id ? t.amount : 0) - (t.fromBankId === activeBank.id ? t.amount : 0), 0);
    return { income, expense, savings: income - expense, balance: balanceTransactions + transferBalance };
  }, [data, activeBank?.id, activePeriod?.id]);

  const monthly = useMemo(() => sortedPeriods.map((p) => {
    const txns = data.transactions.filter((t) => t.bankId === activeBank?.id && t.periodId === p.id);
    const income = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { ...p, income, expense, savings: income - expense };
  }), [sortedPeriods, data.transactions, activeBank?.id]);

  if (!unlocked) return <>
    <LoginScreen autoLoading={booting} error={error} onOpenFile={openAccountFromData} onCreateAccount={createAccount} />
    {pendingOpen && <PasswordDialog profile={(pendingOpen.data || pendingOpen).profile} onUnlock={unlockPending} onCancel={() => setPendingOpen(null)} />}
  </>;

  const visibleMonths = showAllMonths ? monthly : monthly.slice(0, 6);
  const transferOptions = sortedBanks.filter((b) => b.id !== transferForm.fromBankId);
  const totalSavings = data.transactions.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);

  return <div className="app-shell">
    <header className="topbar">
      <div><div className="eyebrow">PERSONAL FINANCE • LOCAL FIRST</div><h1>Daily Money Tracker</h1><p>{fileName || 'Excel workbook'} • No backend required</p></div>
      <div className="topbar-total"><span>NET TOTAL SAVINGS</span><strong>{money(totalSavings)}</strong><small>All banks • all started months</small></div>
      <ProfileMenu email={data.profile.email} onLogout={handleLogout} onSave={() => saveCurrent(false)} onOpen={openExisting} onBackup={() => saveCurrent(true)} />
    </header>

    <input ref={fileInputRef} className="hidden-file" type="file" accept=".xlsx,.xls" onChange={(e) => handleFallbackOpen(e.target.files?.[0])} />
    {(notice || error) && <div className={error ? 'notice error' : 'notice success'}>{error || notice}</div>}

    <nav className="main-tabs" aria-label="Primary navigation">
      <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
      <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>Accounts & Transactions</button>
    </nav>

    {tab === 'dashboard' ? <Dashboard data={data} /> : <>
      <section className="panel bank-section">
        <div className="section-title"><div><h2>Bank Accounts</h2><p>Each bank is a separate tab. Transfers between your own banks do not count as income or expense.</p></div><button className="secondary-button" onClick={() => setShowBankForm(!showBankForm)}>+ Add Bank</button></div>
        {showBankForm && <form className="inline-form" onSubmit={addBank}><input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank name e.g. ICICI Bank" maxLength={60} autoFocus /><button className="primary-button small">Add Bank</button></form>}
        {sortedBanks.length ? <div className="bank-tabs">{sortedBanks.map((bank) => <button key={bank.id} className={activeBank?.id === bank.id ? 'bank-tab active' : 'bank-tab'} onClick={() => { setBankId(bank.id); setFilter(''); }}>{bank.name}</button>)}</div> : <div className="empty compact"><strong>Add your first bank account</strong><span>Example: ICICI Bank, HDFC Bank, SBI.</span></div>}
      </section>

      <section className="panel month-control-panel">
        <div className="section-title"><div><h2>Financial Month</h2><p>Start a month only when you choose the date. Your salary cycle is not reset on the 1st.</p></div><button className="secondary-button" onClick={() => setShowPeriodForm(!showPeriodForm)}>+ Start New Month</button></div>
        {showPeriodForm && <form className="start-month-form" onSubmit={addPeriod}><label>Start date<input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} required /></label><div className="month-form-help">Example: 25th → 24th is a natural salary-cycle month.</div><button className="primary-button small">Start Month</button></form>}
        {sortedPeriods.length ? <div className="period-tabs">{sortedPeriods.map((p) => <button key={p.id} className={activePeriod?.id === p.id ? 'period-tab active' : 'period-tab'} onClick={() => setPeriodId(p.id)}>{periodLabel(p)}</button>)}</div> : <div className="empty compact"><strong>No financial month started</strong><span>Start the first month before adding income, expenses or transfers.</span></div>}
      </section>

      {activeBank && activePeriod ? <>
        <div className="account-header"><div><h2>{activeBank.name}</h2><p>{periodLabel(activePeriod)}</p></div><div className="account-actions"><div className="mini-stat">Selected-month savings <strong>{money(summary.savings)}</strong></div><div className="mini-stat">Bank balance <strong>{money(summary.balance)}</strong></div><button className="danger-link" onClick={removeBank}>Delete account</button></div></div>

        <section className="summary-grid"><div className="summary-card income-card"><span>Income</span><strong>{money(summary.income)}</strong></div><div className="summary-card expense-card"><span>Expense</span><strong>{money(summary.expense)}</strong></div><div className="summary-card balance-card"><span>Monthly Savings</span><strong>{money(summary.savings)}</strong></div></section>

        <section className="panel transfer-panel"><div className="section-title"><div><h2>Self Transfer</h2><p>Move your own money from one bank to another. It affects balances, not income/expense totals.</p></div>{sortedBanks.length >= 2 && <button className="secondary-button" onClick={() => setShowTransferForm(!showTransferForm)}>{showTransferForm ? 'Close Transfer' : '+ Transfer Money'}</button>}</div>
          {sortedBanks.length < 2 ? <div className="empty compact"><strong>Add another bank to enable transfers</strong><span>The new bank will automatically appear in the transfer list.</span></div> : <>
            {showTransferForm && <form className="transfer-form" onSubmit={addTransfer}><label>From bank<select value={transferForm.fromBankId || activeBank.id} onChange={(e) => setTransferForm((f) => ({ ...f, fromBankId: e.target.value, toBankId: f.toBankId === e.target.value ? (transferOptions[0]?.id || '') : f.toBankId }))}>{sortedBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>To bank<select value={transferForm.toBankId || transferOptions[0]?.id || ''} onChange={(e) => setTransferForm((f) => ({ ...f, toBankId: e.target.value }))}>{transferOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Amount<div className="amount-input"><span>₹</span><input type="number" inputMode="decimal" min="0" step="0.01" value={transferForm.amount} onChange={(e) => setTransferForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" required /></div></label><label>Date<input type="date" value={transferForm.date} onChange={(e) => setTransferForm((f) => ({ ...f, date: e.target.value }))} required /></label><label className="wide-field">Note<input value={transferForm.note} onChange={(e) => setTransferForm((f) => ({ ...f, note: e.target.value }))} placeholder="Optional" maxLength={200} /></label><button className="primary-button transfer-button">Transfer Money</button></form>}
            {selectedTransfers.length ? <div className="transfer-list">{selectedTransfers.map((item) => { const from = sortedBanks.find((b) => b.id === item.fromBankId)?.name || 'Unknown'; const to = sortedBanks.find((b) => b.id === item.toBankId)?.name || 'Unknown'; return <article className="transfer-row" key={item.id}><div className="transfer-icon">⇄</div><div className="transaction-info"><strong>{from} → {to}</strong><span>{dateLabel(item.date)}{item.note ? ` • ${item.note}` : ''}</span></div><div className="transaction-amount">{money(item.amount)}</div><button className="delete-button" onClick={() => { if (window.confirm('Delete this transfer?')) deleteItem('transfer', item.id); }}>×</button></article>; })}</div> : !showTransferForm && <div className="empty compact"><strong>No transfers in this financial month</strong><span>Your self-transfers will appear here.</span></div>}
          </>}
        </section>

        <section className="panel monthly-panel"><div className="section-title"><div><h2>Monthly History</h2><p>Income, expense and savings for this bank across your started months.</p></div><select className="month-picker" value={activePeriod.id} onChange={(e) => setPeriodId(e.target.value)}>{sortedPeriods.map((p) => <option key={p.id} value={p.id}>{periodLabel(p)}</option>)}</select></div>{visibleMonths.length ? <div className="month-list">{visibleMonths.map((m) => <button key={m.id} className={`month-row ${m.id === activePeriod.id ? 'selected' : ''}`} onClick={() => setPeriodId(m.id)}><span>{periodLabel(m)}</span><span>Income {money(m.income)}</span><span className="month-expense">Expense {money(m.expense)}</span><span className={m.savings >= 0 ? 'month-savings' : 'month-loss'}>Savings {money(m.savings)}</span></button>)}</div> : <div className="empty compact"><strong>No monthly records</strong></div>}{monthly.length > 6 && <button className="show-more" onClick={() => setShowAllMonths(!showAllMonths)}>{showAllMonths ? 'Show recent months' : 'View all months'}</button>}</section>

        <section className="content-grid"><section className="panel"><div className="panel-heading"><div><h2>{type === 'expense' ? 'Add Expense' : 'Add Income'}</h2><p>{activeBank.name} • {periodLabel(activePeriod)}</p></div><div className="type-switch"><button className={type === 'expense' ? 'active expense' : ''} onClick={() => { setType('expense'); setForm(makeInitialForm('expense', activePeriod)); }}>+ Expense</button><button className={type === 'income' ? 'active income' : ''} onClick={() => { setType('income'); setForm(makeInitialForm('income', activePeriod)); }}>+ Income</button></div></div><form className="transaction-form" onSubmit={addTransaction}><label>Amount<div className="amount-input"><span>₹</span><input type="number" inputMode="decimal" min="0" step="0.01" name="amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" required /></div></label><label>Category<select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>{(type === 'expense' ? expenseCategories : incomeCategories).map((c) => <option key={c}>{c}</option>)}</select></label><label>Date<input type="date" value={form.date} min={activePeriod.startDate} max={activePeriod.endDate || periodEnd(activePeriod.startDate)} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required /></label><label className="wide-field">Note<input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Optional note" maxLength={200} /></label><button className="primary-button form-submit">{type === 'expense' ? 'Add Expense' : 'Add Income'}</button></form></section>

          <section className="panel"><div className="panel-heading"><div><h2>Transactions</h2><p>Only the selected bank and financial month are shown.</p></div><input className="search-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search category or note" /></div>{selectedBankTransactions.length ? <div className="transaction-list">{selectedBankTransactions.map((item) => <article className="transaction-row" key={item.id}><div className={`transaction-icon ${item.type}`}>{item.type === 'income' ? '↓' : '↑'}</div><div className="transaction-info"><strong>{item.category}</strong><span>{dateLabel(item.date)}{item.note ? ` • ${item.note}` : ''}</span></div><div className={item.type === 'income' ? 'transaction-amount positive' : 'transaction-amount negative'}>{item.type === 'income' ? '+' : '-'}{money(item.amount)}</div><button className="delete-button" title="Delete" onClick={() => { if (window.confirm('Delete this transaction?')) deleteItem('transaction', item.id); }}>×</button></article>)}</div> : <div className="empty"><strong>No transactions</strong><span>Add an income or expense for this financial month.</span></div>}</section></section>
      </> : <section className="panel empty"><strong>Select a bank and start a financial month</strong><span>Your existing bank tabs and monthly controls stay available above.</span></section>}
    </>}

    <footer className="app-footer">Local-first financial tracker • Excel workbook is the source of truth • <button onClick={() => saveCurrent(true)}>Export Excel copy</button></footer>
  </div>;
}

export default App;
