import axios from 'axios'

// Everything goes through the AGENT's backend, never straight to App1.
// That matters: the agent secret stays in appsettings.json on the server and
// is never handed to a browser.
const api = axios.create({ baseURL: '/api/agent' })

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('agent_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const errorText = (e) =>
  e?.response?.data?.message || e?.message || 'Something went wrong'

export const auth = {
  login: (username, password) => api.post('/login', { username, password }).then((r) => r.data),
  me: () => api.get('/me').then((r) => r.data),
}

export const agent = {
  status: () => api.get('/status').then((r) => r.data),
  devices: () => api.get('/devices').then((r) => r.data),
  createDevice: (data) => api.post('/devices', data).then((r) => r.data),
  updateDevice: (id, data) => api.put(`/devices/${id}`, data).then((r) => r.data),
  deleteDevice: (id) => api.delete(`/devices/${id}`).then((r) => r.data),
  testConnection: (id) => api.post(`/devices/${id}/test-connection`).then((r) => r.data),
  sync: (deviceId, options) => api.post(`/sync/${deviceId}`, options || {}).then((r) => r.data),
  runs: () => api.get('/runs').then((r) => r.data),
  runDetails: (id) => api.get(`/runs/${id}`).then((r) => r.data),
  outbox: (status) => api.get('/outbox', { params: { status } }).then((r) => r.data),
  drain: () => api.post('/outbox/drain').then((r) => r.data),
  retryDead: () => api.post('/outbox/retry-dead').then((r) => r.data),
  clearOutbox: () => api.post('/outbox/clear').then((r) => r.data),
  summary: (date) => api.get('/summary', { params: { date } }).then((r) => r.data),
}

/** dd/mm/yyyy hh:mm, matching App1 rather than inventing a second format. */
export function dt(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
