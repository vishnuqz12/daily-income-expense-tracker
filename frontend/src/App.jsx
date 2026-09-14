import { useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';

const incomeCategories = ['Salary','Freelance','Business','Interest','Other'];
const expenseCategories = ['Food','Travel','Shopping','Bills','Rent','Health','Entertainment','EMI','Other'];
const today = () => new Date().toISOString().slice(0,10);
const money = (value) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(value || 0);
const dateLabel = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
const periodLabel = (period) => period?.label || 'No month started';

function AuthScreen({ onSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    if (mode === 'register' && password.length < 8) return setError('Password must be at least 8 characters.');
    if (mode === 'register' && password !== confirm) return setError('Passwords do not match.');
    try {
      setBusy(true);
      const user = mode === 'login' ? await api.login(email.trim(), password) : await api.register(email.trim(), password);
      onSuccess(user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return <div className="auth-shell">
    <div className="auth-card">
      <div className="eyebrow">PERSONAL FINANCE</div>
      <h1>Daily Money Tracker</h1>
      <p className="auth-subtitle">Your income, expenses and savings stay private to your account.</p>
      <div className="auth-switch"><button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('')}}>Login</button><button className={mode==='register'?'active':''} onClick={()=>{setMode('register');setError('')}}>Create account</button></div>
      {error && <div className="error">{error}</div>}
      <form onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required/></label>
        <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='register'?'At least 8 characters':'Your password'} autoComplete={mode==='register'?'new-password':'current-password'} required/></label>
        {mode==='register' && <label>Confirm password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" required/></label>}
        <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : mode==='login' ? 'Login' : 'Create account'}</button>
      </form>
      <p className="auth-note">Each account gets its own banks, financial months, income, expenses and savings.</p>
    </div>
  </div>
}

function Dashboard({ dashboard, loading }) {
  if (loading) return <section className="panel empty"><strong>Loading dashboard…</strong></section>;
  const current = dashboard?.current_period;
  const previous = dashboard?.previous_period;
  const max = Math.max(current?.income || 0, previous?.income || 0, current?.expense || 0, previous?.expense || 0, 1);
  const width = (v) => `${Math.max(3, Math.round((v / max) * 100))}%`;
  const comparison = dashboard?.comparison || {};
  const deltaText = (value, pct, type) => {
    if (!previous) return 'No previous month yet';
    const sign = value > 0 ? '+' : '';
    const label = type === 'expense' ? (value > 0 ? 'higher expense' : 'lower expense') : (value > 0 ? 'higher income' : 'lower income');
    return `${sign}${money(value)} ${label}${pct == null ? '' : ` (${sign}${pct}%)`}`;
  };
  return <div className="dashboard-grid">
    <section className="panel dashboard-hero">
      <div><div className="eyebrow">DASHBOARD</div><h2>Monthly comparison</h2><p>Current and previous financial months use the start dates you create, not calendar months.</p></div>
      <div className="dashboard-total"><span>MY TOTAL SAVINGS</span><strong>{money(dashboard?.total_savings || 0)}</strong><small>All banks • all started months</small></div>
    </section>

    <section className="comparison-grid">
      <div className="panel comparison-card"><span className="comparison-label">CURRENT MONTH</span><h3>{periodLabel(current)}</h3><div className="compare-metric"><div><span>Income</span><strong>{money(current?.income)}</strong></div><div><span>Expense</span><strong>{money(current?.expense)}</strong></div><div><span>Savings</span><strong>{money(current?.savings)}</strong></div></div></div>
      <div className="panel comparison-card muted"><span className="comparison-label">LAST MONTH</span><h3>{previous ? periodLabel(previous) : 'Not started yet'}</h3><div className="compare-metric"><div><span>Income</span><strong>{money(previous?.income)}</strong></div><div><span>Expense</span><strong>{money(previous?.expense)}</strong></div><div><span>Savings</span><strong>{money(previous?.savings)}</strong></div></div></div>
    </section>

    <section className="panel compare-bars"><div className="section-title"><div><h2>Income & Expense</h2><p>Comparison between the two most recent financial months.</p></div></div>
      {!current ? <div className="empty compact"><strong>Start your first financial month</strong><span>Go to Accounts and choose the date your month begins.</span></div> : <div className="bar-group">
        <div className="bar-row"><div className="bar-name">Income</div><div className="bar-track"><div className="bar current income-bar" style={{width:width(current.income)}}></div>{previous && <div className="bar previous income-bar" style={{width:width(previous.income)}}></div>}</div><div className="bar-values"><span>{money(current.income)}</span><span>{previous ? money(previous.income) : '—'}</span></div></div>
        <div className="bar-row"><div className="bar-name">Expense</div><div className="bar-track"><div className="bar current expense-bar" style={{width:width(current.expense)}}></div>{previous && <div className="bar previous expense-bar" style={{width:width(previous.expense)}}></div>}</div><div className="bar-values"><span>{money(current.expense)}</span><span>{previous ? money(previous.expense) : '—'}</span></div></div>
      </div>}
      {current && <div className="comparison-callouts"><div><strong>Income</strong><span>{deltaText(comparison.income_change, comparison.income_change_pct, 'income')}</span></div><div><strong>Expense</strong><span>{deltaText(comparison.expense_change, comparison.expense_change_pct, 'expense')}</span></div></div>}
    </section>

    <section className="panel dashboard-note"><strong>Salary-day month</strong><span>Your month only changes when you add a new start date. For example, if salary arrives on the 25th, start each new financial month on the 25th. The app never automatically resets your month.</span></section>
  </div>
}

function Accounts({ user, dashboard, refreshDashboard }) {
  const [banks,setBanks] = useState([]);
  const [bankId,setBankId] = useState('');
  const [periods,setPeriods] = useState([]);
  const [periodId,setPeriodId] = useState('');
  const [transactions,setTransactions] = useState([]);
  const [summary,setSummary] = useState({income:0,expense:0,savings:0,transaction_count:0});
  const [monthly,setMonthly] = useState([]);
  const [showAllMonths,setShowAllMonths] = useState(false);
  const [showBankForm,setShowBankForm] = useState(false);
  const [bankName,setBankName] = useState('');
  const [showPeriodForm,setShowPeriodForm] = useState(false);
  const [newStartDate,setNewStartDate] = useState(today());
  const [type,setType] = useState('expense');
  const [filter,setFilter] = useState('');
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [form,setForm] = useState({amount:'',category:'Food',date:today(),note:''});
  const categories = useMemo(() => type === 'income' ? incomeCategories : expenseCategories,[type]);

  async function loadBase() {
    try {
      const [bankItems, periodItems] = await Promise.all([api.getBanks(), api.getPeriods()]);
      setBanks(bankItems); setPeriods(periodItems);
      setBankId(prev => prev && bankItems.some(b=>b.id===prev) ? prev : bankItems[0]?.id || '');
      setPeriodId(prev => prev && periodItems.some(p=>p.id===prev) ? prev : periodItems[0]?.id || '');
    } catch(e) { setError(e.message); }
  }

  async function loadData() {
    if (!bankId || !periodId) { setTransactions([]); setSummary({income:0,expense:0,savings:0,transaction_count:0}); setMonthly([]); setLoading(false); return; }
    try {
      setLoading(true); setError('');
      const [items,total,months] = await Promise.all([
        api.getTransactions({bankId,type:filter,periodId}), api.getSummary({bankId,periodId}), api.getMonthlySummary(bankId)
      ]);
      setTransactions(items); setSummary(total); setMonthly(months);
    } catch(e){ setError(e.message); } finally { setLoading(false); }
  }

  useEffect(()=>{loadBase()},[]);
  useEffect(()=>{loadData()},[bankId,periodId,filter]);

  function resetTransactionDate(nextPeriodId = periodId) {
    const active = periods.find(p=>p.id===nextPeriodId);
    const current = today();
    const fallback = active && current < active.start_date ? active.start_date : current;
    setForm({amount:'',category:type==='income'?'Salary':'Food',date:fallback,note:''});
  }

  async function addBank(e) {
    e.preventDefault(); if(!bankName.trim()) return;
    try { const bank=await api.addBank(bankName.trim()); setBankName(''); setShowBankForm(false); setBanks([...banks,bank]); setBankId(bank.id); }
    catch(e){setError(e.message)}
  }
  async function removeBank() {
    if(!bankId || !window.confirm('Delete this bank and all transactions recorded under it?')) return;
    try { await api.deleteBank(bankId); const remaining=banks.filter(b=>b.id!==bankId); setBanks(remaining); setBankId(remaining[0]?.id || ''); }
    catch(e){setError(e.message)}
  }
  async function addPeriod(e) {
    e.preventDefault(); if(!newStartDate) return;
    try {
      const created = await api.addPeriod(newStartDate);
      const next = [created, ...periods];
      setPeriods(next); setPeriodId(created.id); setShowPeriodForm(false); resetTransactionDate(created.id); await refreshDashboard();
    } catch(e){setError(e.message)}
  }
  function update(e){setForm({...form,[e.target.name]:e.target.value})}
  async function submit(e){
    e.preventDefault(); if(!bankId) return setError('Add a bank account first.');
    if(!periodId) return setError('Start a financial month before adding transactions.');
    if(!form.amount || Number(form.amount)<=0){setError('Enter an amount greater than 0.');return}
    try { await api.addTransaction({bank_id:bankId,type,amount:Number(form.amount),category:form.category,date:form.date,note:form.note}); resetTransactionDate(); await loadData(); await refreshDashboard(); }
    catch(e){setError(e.message)}
  }
  async function remove(id){if(!window.confirm('Delete this transaction?')) return; try{await api.deleteTransaction(id);await loadData();await refreshDashboard()}catch(e){setError(e.message)}}

  const visibleMonths = showAllMonths ? monthly : monthly.slice(0,6);
  const selectedBank = banks.find(b=>b.id===bankId);
  const selectedPeriod = periods.find(p=>p.id===periodId);
  const selectedBankNet = monthly.reduce((sum,m)=>sum+m.savings,0);

  return <>
    <section className="panel bank-section">
      <div className="section-title"><div><h2>Bank Accounts</h2><p>Each bank has its own income, expenses and savings.</p></div><button className="secondary-button" onClick={()=>setShowBankForm(!showBankForm)}>+ Add Bank</button></div>
      {showBankForm && <form className="bank-form" onSubmit={addBank}><input value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="Bank name e.g. ICICI Bank" autoFocus/><button className="primary-button small" type="submit">Add Bank</button></form>}
      {banks.length ? <div className="bank-tabs">{banks.map(bank=><button key={bank.id} className={bank.id===bankId?'bank-tab active':'bank-tab'} onClick={()=>{setBankId(bank.id);setFilter('')}}>{bank.name}</button>)}</div> : <div className="empty compact"><strong>Add your first bank account</strong><span>For example: ICICI Bank, HDFC Bank, SBI</span></div>}
    </section>

    <section className="panel month-control-panel">
      <div className="section-title"><div><h2>Financial Month</h2><p>Start a new month only when you choose the start date. Your month does not reset automatically.</p></div><button className="secondary-button" onClick={()=>setShowPeriodForm(!showPeriodForm)}>+ Start New Month</button></div>
      {showPeriodForm && <form className="start-month-form" onSubmit={addPeriod}><label>New month start date<input type="date" value={newStartDate} onChange={e=>setNewStartDate(e.target.value)} required/></label><div className="month-form-help">Example: choose the 25th when your salary arrives on the 25th.</div><button className="primary-button small" type="submit">Start Month</button></form>}
      {periods.length ? <div className="period-tabs">{periods.map(p=><button key={p.id} className={p.id===periodId?'period-tab active':'period-tab'} onClick={()=>{setPeriodId(p.id);resetTransactionDate(p.id)}}>{periodLabel(p)}</button>)}</div> : <div className="empty compact"><strong>No financial month started</strong><span>Choose the date your current month begins before adding transactions.</span></div>}
    </section>

    {selectedBank && selectedPeriod && <>
      <div className="account-header"><div><h2>{selectedBank.name}</h2><p>{periodLabel(selectedPeriod)}</p></div><div className="account-actions"><div className="mini-net">Selected bank net: <strong>{money(selectedBankNet)}</strong></div><button className="danger-link" onClick={removeBank}>Delete account</button></div></div>

      <section className="summary-grid">
        <div className="summary-card income-card"><span>{periodLabel(selectedPeriod)} Income</span><strong>{money(summary.income)}</strong></div>
        <div className="summary-card expense-card"><span>{periodLabel(selectedPeriod)} Expense</span><strong>{money(summary.expense)}</strong></div>
        <div className="summary-card balance-card"><span>Monthly Savings</span><strong>{money(summary.savings)}</strong></div>
      </section>

      <section className="monthly-panel panel">
        <div className="section-title"><div><h2>Monthly Expense History</h2><p>Every month here uses the start date you gave the app.</p></div><label className="month-picker">View month<select value={periodId} onChange={e=>{setPeriodId(e.target.value);resetTransactionDate(e.target.value)}}>{periods.map(p=><option key={p.id} value={p.id}>{periodLabel(p)}</option>)}</select></label></div>
        {monthly.length===0 ? <div className="empty compact"><strong>No monthly records yet</strong><span>Start a month and add income or expense transactions.</span></div> : <div className="month-list">{visibleMonths.map(m=><button key={m.period_id} className={`month-row ${m.period_id===periodId?'selected':''}`} onClick={()=>{setPeriodId(m.period_id);resetTransactionDate(m.period_id)}}><span>{periodLabel(m)}</span><span className="month-expense">Expense {money(m.expense)}</span><span className={m.savings>=0?'month-savings':'month-loss'}>Savings {money(m.savings)}</span></button>)}</div>}
        {monthly.length>6 && <button className="show-more" onClick={()=>setShowAllMonths(!showAllMonths)}>{showAllMonths?'Show recent months':'View all months'}</button>}
      </section>

      <main className="content-grid">
        <section className="panel">
          <div className="panel-heading"><div><h2>{type==='expense'?'Add Expense':'Add Income'}</h2><p>{periodLabel(selectedPeriod)} • {selectedBank.name}</p></div></div>
          <div className="type-switch"><button className={type==='expense'?'active expense':''} onClick={()=>{setType('expense');setForm(f=>({...f,category:'Food'}))}}>+ Expense</button><button className={type==='income'?'active income':''} onClick={()=>{setType('income');setForm(f=>({...f,category:'Salary'}))}}>+ Income</button></div>
          <form onSubmit={submit}>
            <label>Amount<div className="amount-input"><span>₹</span><input name="amount" type="number" inputMode="decimal" min="0" step="0.01" value={form.amount} onChange={update} placeholder="0.00" required/></div></label>
            <label>Category<select name="category" value={form.category} onChange={update}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
            <label>Date<input name="date" type="date" value={form.date} onChange={update} required/></label>
            <label>Note<input name="note" value={form.note} onChange={update} placeholder="e.g. Grocery shopping" maxLength={200}/></label>
            <button className={`primary-button ${type}`} type="submit">+ Add {type==='expense'?'Expense':'Income'}</button>
          </form>
        </section>

        <section className="panel transactions-panel">
          <div className="panel-heading transactions-heading"><div><h2>Transactions</h2><p>{summary.transaction_count} records for {selectedBank.name}</p></div><select className="filter" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All</option><option value="income">Income</option><option value="expense">Expense</option></select></div>
          {loading?<div className="empty">Loading...</div>:transactions.length===0?<div className="empty"><div className="empty-icon">₹</div><strong>No transactions for this month</strong><span>Add your first income or expense.</span></div>:<div className="transaction-list">{transactions.map(item=><article className="transaction" key={item.id}><div className={`transaction-icon ${item.type}`}>{item.type==='income'?'↓':'↑'}</div><div className="transaction-info"><strong>{item.category}</strong><span>{dateLabel(item.date)}{item.note?` • ${item.note}`:''}</span></div><div className={`transaction-amount ${item.type}`}>{item.type==='income'?'+':'-'}{money(item.amount)}</div><button className="delete-button" title="Delete" onClick={()=>remove(item.id)}>×</button></article>)}</div>}
        </section>
      </main>
    </>}
  </>
}

function App() {
  const [token,setLocalToken] = useState(getToken());
  const [user,setUser] = useState(null);
  const [activeTab,setActiveTab] = useState('dashboard');
  const [dashboard,setDashboard] = useState(null);
  const [dashboardLoading,setDashboardLoading] = useState(true);
  const [globalError,setGlobalError] = useState('');

  async function loadDashboard() {
    if (!getToken()) return;
    try { setDashboardLoading(true); setDashboard(await api.getDashboard()); setGlobalError(''); }
    catch(e){ setGlobalError(e.message); if (!getToken()) { setLocalToken(''); setUser(null); } }
    finally { setDashboardLoading(false); }
  }

  async function afterLogin(nextUser) { setUser(nextUser); setLocalToken(getToken()); setActiveTab('dashboard'); await loadDashboard(); }

  useEffect(()=>{
    if (!token) { setUser(null); return; }
    api.me().then(setUser).catch(()=>{ setToken(''); setLocalToken(''); setUser(null); });
  },[token]);
  useEffect(()=>{ if (token && user) loadDashboard(); },[token,user]);

  async function logout(){ await api.logout(); setToken(''); setLocalToken(''); setUser(null); }
  if (!token || !user) return <AuthScreen onSuccess={afterLogin}/>;

  return <div className="app">
    <header className="topbar">
      <div><p className="eyebrow">PERSONAL FINANCE</p><h1>Daily Money Tracker</h1><p className="subtitle">Track every bank account, every month, and your total savings.</p></div>
      <div className="profile-chip"><div className="profile-avatar">{user.email.slice(0,1).toUpperCase()}</div><div><strong>{user.email}</strong><span>Your private profile</span></div><button onClick={logout}>Log out</button></div>
    </header>

    {globalError && <div className="error">{globalError}</div>}
    <section className="install-tip" aria-label="iPhone installation help"><span className="install-tip-icon">⌂</span><div><strong>Use it like an iPhone app</strong><span>In Safari, tap Share → Add to Home Screen.</span></div></section>

    <nav className="main-tabs" aria-label="Main navigation"><button className={activeTab==='dashboard'?'active':''} onClick={()=>setActiveTab('dashboard')}>Dashboard</button><button className={activeTab==='accounts'?'active':''} onClick={()=>setActiveTab('accounts')}>Accounts & Transactions</button></nav>

    {activeTab==='dashboard' ? <Dashboard dashboard={dashboard} loading={dashboardLoading}/> : <Accounts user={user} dashboard={dashboard} refreshDashboard={loadDashboard}/>} 
  </div>;
}

export default App;
