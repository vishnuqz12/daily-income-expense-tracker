const API_URL = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Something went wrong');
  }
  return response.json();
}

export const api = {
  getBanks: () => request('/banks'),
  addBank: (name) => request('/banks', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteBank: (id) => request(`/banks/${id}`, { method: 'DELETE' }),
  getTransactions: ({ bankId, type = '', month = '' }) => request(`/transactions?bank_id=${encodeURIComponent(bankId)}${type ? `&transaction_type=${type}` : ''}${month ? `&month=${month}` : ''}`),
  getSummary: ({ bankId, month = '' }) => request(`/summary?bank_id=${encodeURIComponent(bankId)}${month ? `&month=${month}` : ''}`),
  getMonthlySummary: (bankId) => request(`/monthly-summary?bank_id=${encodeURIComponent(bankId)}`),
  addTransaction: (data) => request('/transactions', { method: 'POST', body: JSON.stringify(data) }),
  deleteTransaction: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),
};
