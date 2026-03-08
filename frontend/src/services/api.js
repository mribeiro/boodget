const BASE = '/api';

async function request(method, path, body) {
  const options = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  // Setup
  getSetupStatus: () => request('GET', '/setup/status'),
  createFirstUser: (data) => request('POST', '/setup/create-first-user', data),

  // Auth
  me: () => request('GET', '/auth/me'),
  login: (data) => request('POST', '/auth/login', data),
  logout: () => request('POST', '/auth/logout'),
  changePassword: (data) => request('POST', '/auth/change-password', data),
  getOidcConfig: () => request('GET', '/auth/oidc/config'),

  // Users
  getUsers: () => request('GET', '/users'),
  createUser: (data) => request('POST', '/users', data),
  deleteUser: (id) => request('DELETE', `/users/${id}`),

  // Dossiers
  getDossiers: () => request('GET', '/dossiers'),
  createDossier: (data) => request('POST', '/dossiers', data),
  getDossier: (id) => request('GET', `/dossiers/${id}`),
  deleteDossier: (id) => request('DELETE', `/dossiers/${id}`),
  getDossierAccess: (id) => request('GET', `/dossiers/${id}/access`),
  shareDossier: (id, data) => request('POST', `/dossiers/${id}/access`, data),
  revokeAccess: (id, userId) => request('DELETE', `/dossiers/${id}/access/${userId}`),

  // Accounts
  getAccounts: (dossierId, includeArchived = false) =>
    request('GET', `/dossiers/${dossierId}/accounts${includeArchived ? '?includeArchived=true' : ''}`),
  createAccount: (dossierId, data) => request('POST', `/dossiers/${dossierId}/accounts`, data),
  updateAccount: (dossierId, accountId, data) =>
    request('PATCH', `/dossiers/${dossierId}/accounts/${accountId}`, data),
  deleteAccount: (dossierId, accountId) =>
    request('DELETE', `/dossiers/${dossierId}/accounts/${accountId}`),
  reorderAccounts: (dossierId, order) =>
    request('PUT', `/dossiers/${dossierId}/accounts/reorder`, { order }),

  // Export / Import
  exportDossier: (id) => request('GET', `/dossiers/${id}/export`),
  importDossier: (data) => request('POST', '/dossiers/import', data),

  // Months
  getMonths: (dossierId) => request('GET', `/dossiers/${dossierId}/months`),
  getCompare: (dossierId) => request('GET', `/dossiers/${dossierId}/months/compare`),
  createMonth: (dossierId, data) => request('POST', `/dossiers/${dossierId}/months`, data),
  getMonth: (dossierId, monthId) => request('GET', `/dossiers/${dossierId}/months/${monthId}`),
  saveMonth: (dossierId, monthId, data) =>
    request('PUT', `/dossiers/${dossierId}/months/${monthId}`, data),
  resetMonth: (dossierId, monthId) =>
    request('POST', `/dossiers/${dossierId}/months/${monthId}/reset`),
  syncMonthAccounts: (dossierId, monthId) =>
    request('POST', `/dossiers/${dossierId}/months/${monthId}/sync-accounts`),

  // Dossier settings
  getDossierSettings: (dossierId) => request('GET', `/dossiers/${dossierId}/settings`),
  updateDossierSettings: (dossierId, data) => request('PATCH', `/dossiers/${dossierId}/settings`, data),

  // Expense template
  getExpenseTemplate: (dossierId) => request('GET', `/dossiers/${dossierId}/expense-template`),
  createTemplateItem: (dossierId, data) => request('POST', `/dossiers/${dossierId}/expense-template`, data),
  updateTemplateItem: (dossierId, itemId, data) =>
    request('PUT', `/dossiers/${dossierId}/expense-template/${itemId}`, data),
  deleteTemplateItem: (dossierId, itemId) =>
    request('DELETE', `/dossiers/${dossierId}/expense-template/${itemId}`),

  // Cycles
  getCycles: (dossierId) => request('GET', `/dossiers/${dossierId}/cycles`),
  createCycle: (dossierId, data) => request('POST', `/dossiers/${dossierId}/cycles`, data),
  getCycle: (dossierId, cycleId) => request('GET', `/dossiers/${dossierId}/cycles/${cycleId}`),
  updateCycle: (dossierId, cycleId, data) =>
    request('PATCH', `/dossiers/${dossierId}/cycles/${cycleId}`, data),
  createCycleItem: (dossierId, cycleId, data) =>
    request('POST', `/dossiers/${dossierId}/cycles/${cycleId}/items`, data),
  updateCycleItem: (dossierId, cycleId, itemId, data) =>
    request('PATCH', `/dossiers/${dossierId}/cycles/${cycleId}/items/${itemId}`, data),
  deleteCycleItem: (dossierId, cycleId, itemId) =>
    request('DELETE', `/dossiers/${dossierId}/cycles/${cycleId}/items/${itemId}`),
};
