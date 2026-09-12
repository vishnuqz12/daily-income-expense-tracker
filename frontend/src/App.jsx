import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

const incomeCategories = ['Salary','Freelance','Business','Interest','Other'];
const expenseCategories = ['Food','Travel','Shopping','Bills','Rent','Health','Entertainment','EMI','Other'];
const currentMonth = new Date().toISOString().slice(0,7);
const monthName = (value) => new Date(`${value}-01T00:00:00`).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
const money = (value) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(value || 0);

function App() {
  const [banks,setBanks] = useState([]);
  const [bankId,setBankId] = useState('');
  const [transactions,setTransactions] = useState([]);
  const [summary,setSummary] = useState({income:0,expense:0,savings:0,transaction_count:0});
  const [monthly,setMonthly] = useState([]);
  const [month,setMonth] = useState(currentMonth);
  const [showAllMonths,setShowAllMonths] = useState(false);
  const [showBankForm,setShowBankForm] = useState(false);
  const [bankName,setBankName] = useState('');
  const [type,setType] = useState('expense');
  const [filter,setFilter] = useState('');
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [form,setForm] = useState({amount:'',category:'Food',date:new Date().toISOString().slice(0,10),note:''});

  const categories = useMemo(() => type === 'income' ? incomeCategories : expenseCategories,[type]);

  async function loadBanks() {
    try {
      const items = await api.getBanks(); setBanks(items);
      if (!bankId && items.length) setBankId(items[0].id);
      if (bankId && !items.some(b=>b.id===bankId)) setBankId(items[0]?.id || '');
    } catch(e){setError(e.message)}
  }
  async function loadData() {
    if (!bankId) { setTransactions([]); setSummary({income:0,expense:0,savings:0,transaction_count:0}); setMonthly([]); setLoading(false); return; }
    try {
      setLoading(true); setError('');
      const [items,total,months] = await Promise.all([
        api.getTransactions({bankId,type:filter,month}), api.getSummary({bankId,month}), api.getMonthlySummary(bankId)
      ]);
      setTransactions(items); setSummary(total); setMonthly(months);
    } catch(e){setError(e.message)} finally {setLoading(false)}
  }
  useEffect(()=>{loadBanks()},[]);
  useEffect(()=>{loadData()},[bankId,month,filter]);

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
  function update(e){setForm({...form,[e.target.name]:e.target.value})}
  async function submit(e){
    e.preventDefault(); if(!form.amount || Number(form.amount)<=0){setError('Enter an amount greater than 0.');return}
    try { await api.addTransaction({bank_id:bankId,type,amount:Number(form.amount),category:form.category,date:form.date,note:form.note}); setForm({amount:'',category:type==='income'?'Salary':'Food',date:new Date().toISOString().slice(0,10),note:''}); await loadData(); }
    catch(e){setError(e.message)}
  }
  async function remove(id){if(!window.confirm('Delete this transaction?')) return; try{await api.deleteTransaction(id);await loadData()}catch(e){setError(e.message)}}

  const allMonthsSavings = monthly.reduce((sum,m)=>sum+m.savings,0);
  const visibleMonths = showAllMonths ? monthly : monthly.slice(0,6);
  const selectedBank = banks.find(b=>b.id===bankId);

  return <div className="app">
    <header className="topbar">
      <div><p className="eyebrow">PERSONAL FINANCE</p><h1>Daily Money Tracker</h1><p className="subtitle">Track every bank account, every month, and your total savings.</p></div>
      <div className="net-savings"><span>NET TOTAL SAVINGS</span><strong>{money(allMonthsSavings)}</strong><small>All recorded months</small></div>
    </header>

    {error && <div className="error">{error}</div>}

    <section className="install-tip" aria-label="iPhone installation help">
      <span className="install-tip-icon">⌂</span>
      <div><strong>Use it like an iPhone app</strong><span>In Safari, tap Share → Add to Home Screen.</span></div>
    </section>

    <section className="bank-section panel">
      <div className="section-title"><div><h2>Bank Accounts</h2><p>Each bank has its own income, expenses and savings.</p></div><button className="secondary-button" onClick={()=>setShowBankForm(!showBankForm)}>+ Add Bank</button></div>
      {showBankForm && <form className="bank-form" onSubmit={addBank}><input value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="Bank name e.g. ICICI Bank" autoFocus/><button className="primary-button small" type="submit">Add Bank</button></form>}
      {banks.length ? <div className="bank-tabs">{banks.map(bank=><button key={bank.id} className={bank.id===bankId?'bank-tab active':''} onClick={()=>{setBankId(bank.id);setMonth(currentMonth);setFilter('')}}>{bank.name}</button>)}</div> : <div className="empty compact"><strong>Add your first bank account</strong><span>For example: ICICI Bank, HDFC Bank, SBI</span></div>}
    </section>

    {selectedBank && <>
      <div className="account-header"><div><h2>{selectedBank.name}</h2><p>Selected account</p></div><button className="danger-link" onClick={removeBank}>Delete account</button></div>

      <section className="summary-grid">
        <div className="summary-card income-card"><span>{monthName(month)} Income</span><strong>{money(summary.income)}</strong></div>
        <div className="summary-card expense-card"><span>{monthName(month)} Expense</span><strong>{money(summary.expense)}</strong></div>
        <div className="summary-card balance-card"><span>Monthly Savings</span><strong>{money(summary.savings)}</strong></div>
      </section>

      <section className="monthly-panel panel">
        <div className="section-title"><div><h2>Monthly Expense History</h2><p>Choose any month to view the expenses you previously entered.</p></div><label className="month-picker">View month<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label></div>
        {monthly.length===0 ? <div className="empty compact"><strong>No monthly records yet</strong><span>Add income or expense transactions to create your monthly history.</span></div> : <div className="month-list">{visibleMonths.map(m=><button key={m.month} className={`month-row ${m.month===month?'selected':''}`} onClick={()=>setMonth(m.month)}><span>{monthName(m.month)}</span><span className="month-expense">Expense {money(m.expense)}</span><span className={m.savings>=0?'month-savings':'month-loss'}>Savings {money(m.savings)}</span></button>)}</div>}
        {monthly.length>6 && <button className="show-more" onClick={()=>setShowAllMonths(!showAllMonths)}>{showAllMonths?'Show recent months':'View all months'}</button>}
      </section>

      <main className="content-grid">
        <section className="panel">
          <div className="panel-heading"><div><h2>{type==='expense'?'Add Expense':'Add Income'}</h2><p>{monthName(month)} • {selectedBank.name}</p></div></div>
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
          <div className="panel-heading transactions-heading"><div><h2>{monthName(month)} Transactions</h2><p>{summary.transaction_count} records for {selectedBank.name}</p></div><select className="filter" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All</option><option value="income">Income</option><option value="expense">Expense</option></select></div>
          {loading?<div className="empty">Loading...</div>:transactions.length===0?<div className="empty"><div className="empty-icon">₹</div><strong>No transactions for this month</strong><span>Add your first {monthName(month)} income or expense.</span></div>:<div className="transaction-list">{transactions.map(item=><article className="transaction" key={item.id}><div className={`transaction-icon ${item.type}`}>{item.type==='income'?'↓':'↑'}</div><div className="transaction-info"><strong>{item.category}</strong><span>{new Date(`${item.date}T00:00:00`).toLocaleDateString('en-IN')}{item.note?` • ${item.note}`:''}</span></div><div className={`transaction-amount ${item.type}`}>{item.type==='income'?'+':'-'}{money(item.amount)}</div><button className="delete-button" title="Delete" onClick={()=>remove(item.id)}>×</button></article>)}</div>}
        </section>
      </main>
    </>}
  </div>
}
export default App;
