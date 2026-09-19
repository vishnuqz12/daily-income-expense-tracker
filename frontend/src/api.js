const API_URL = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
const TOKEN_KEY = 'money_tracker_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token) => token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) setToken('');
    throw new Error(error.detail || 'Something went wrong');
  }
  return response.status === 204 ? null : response.json();
}

export const api = {
  register: async (email, password) => {
    const result = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    setToken(result.token);
    return result.user;
  },
  login: async (email, password) => {
    const result = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setToken(result.token);
    return result.user;
  },
  logout: async () => {
    try { await request('/auth/logout', { method: 'POST' }); } finally { setToken(''); }
  },
  me: () => request('/auth/me'),
  getBanks: () => request('/banks'),
  addBank: (name) => request('/banks', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteBank: (id) => request(`/banks/${id}`, { method: 'DELETE' }),
  getPeriods: () => request('/periods'),
  addPeriod: (startDate) => request('/periods', { method: 'POST', body: JSON.stringify({ start_date: startDate }) }),
  getTransactions: ({ bankId, type = '', periodId = '' }) => request(`/transactions?bank_id=${encodeURIComponent(bankId)}${type ? `&transaction_type=${type}` : ''}${periodId ? `&period_id=${encodeURIComponent(periodId)}` : ''}`),
  getSummary: ({ bankId, periodId = '' }) => request(`/summary?bank_id=${encodeURIComponent(bankId)}${periodId ? `&period_id=${encodeURIComponent(periodId)}` : ''}`),
  getMonthlySummary: (bankId) => request(`/monthly-summary?bank_id=${encodeURIComponent(bankId)}`),
  addTransaction: (data) => request('/transactions', { method: 'POST', body: JSON.stringify(data) }),
  deleteTransaction: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),
  getTransfers: ({ bankId = '', periodId = '' } = {}) => request(`/transfers${bankId || periodId ? `?${bankId ? `bank_id=${encodeURIComponent(bankId)}` : ''}${bankId && periodId ? '&' : ''}${periodId ? `period_id=${encodeURIComponent(periodId)}` : ''}` : ''}`),
  addTransfer: (data) => request('/transfers', { method: 'POST', body: JSON.stringify(data) }),
  deleteTransfer: (id) => request(`/transfers/${id}`, { method: 'DELETE' }),
  getDashboard: () => request('/dashboard'),
  importBackup: async (file) => {
    const token = getToken();
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${API_URL}/backup/import`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) setToken('');
      throw new Error(error.detail || 'Could not restore backup');
    }
    return response.json();
  },
  downloadBackup: async () => {
    const token = getToken();
    const response = await fetch(`${API_URL}/backup/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Could not create backup');
    }
    return response.blob();
  },
};
