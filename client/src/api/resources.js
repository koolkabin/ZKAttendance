import api from './client'

const get = (url, params) => api.get(url, { params }).then((r) => r.data)
const post = (url, body) => api.post(url, body).then((r) => r.data)
const put = (url, body) => api.put(url, body).then((r) => r.data)
const del = (url) => api.delete(url).then((r) => r.data)

// ── Departments ──────────────────────────────────────────────
export const departments = {
  list: () => get('/Departments'),
  get: (id) => get(`/Departments/${id}`),
  create: (b) => post('/Departments', b),
  update: (id, b) => put(`/Departments/${id}`, b),
  remove: (id) => del(`/Departments/${id}`),
}

// ── Branches ─────────────────────────────────────────────────
export const branches = {
  list: (withDevices) => get('/Branches', withDevices ? { withDevices: true } : undefined),
  get: (id) => get(`/Branches/${id}`),
  create: (b) => post('/Branches', b),
  update: (id, b) => put(`/Branches/${id}`, b),
  remove: (id) => del(`/Branches/${id}`),
}

// ── Devices ──────────────────────────────────────────────────
export const devices = {
  list: (onlineOnly) => get('/Devices', onlineOnly ? { onlineOnly: true } : undefined),
  get: (id) => get(`/Devices/${id}`),
  create: (b) => post('/Devices', b),
  update: (id, b) => put(`/Devices/${id}`, b),
  deactivate: (id) => post(`/Devices/${id}/deactivate`),
  reactivate: (id) => post(`/Devices/${id}/reactivate`),
  testConnection: (id) => post(`/Devices/${id}/test-connection`),
  sync: (id) => post(`/Devices/${id}/sync`),
}

// ── Employees ────────────────────────────────────────────────
export const employees = {
  list: (params) => get('/Employees', typeof params === 'object' ? params : (params ? { departmentId: params } : undefined)),
  get: (id) => get(`/Employees/${id}`),
  create: (b) => post('/Employees', b),
  update: (id, b) => put(`/Employees/${id}`, b),
  deactivate: (id) => post(`/Employees/${id}/deactivate`),
  remove: (id) => del(`/Employees/${id}`),
  unregistered: () => get('/Employees/unregistered'),
  enrollOnDevices: (id, b) => post(`/Employees/${id}/enroll-on-devices`, b),
  pending: () => get('/Employees/pending'),
  approve: (id) => post(`/Employees/${id}/approve`),
  reject: (id, reason) => post(`/Employees/${id}/reject`, { reason }),
  createLogin: (id, b) => post(`/Employees/${id}/create-login`, b),
  updatePhoto: (id, photoUrl) => api.patch(`/Employees/${id}/photo`, { photoUrl }).then(r => r.data),
}

// ── Daily processing, reports and the manual job triggers ────
// Every one of these calls the same service the scheduled job uses.
export const dailyAttendance = {
  report: (params) => get('/Attendance/daily/report', params),
  monthly: (params) => get('/Attendance/daily/monthly', params),
  process: (sendEmails = false, date) => {
    const q = new URLSearchParams()
    if (date) q.set('date', date)
    q.set('sendEmails', String(sendEmails))
    return post(`/Attendance/daily/process?${q}`)
  },
  sendEmails: (date) =>
    post(`/Attendance/daily/send-emails${date ? `?date=${date}` : ''}`),
  emailStatus: () => get('/Attendance/daily/email-status'),
}

// ── Office hours and late-arrival approvals ──────────────────
export const settings = {
  attendance: () => get('/Settings/attendance'),
  saveAttendance: (body) => put('/Settings/attendance', body),
  email: () => get('/Settings/email'),
  saveEmail: (body) => put('/Settings/email', body),
  testEmail: (to) => post(`/Settings/email/test?to=${encodeURIComponent(to)}`),
}

export const approvals = {
  list: (params) => get('/Attendance/approvals', params),
  count: () => get('/Attendance/approvals/count'),
  evaluate: (date) => post(`/Attendance/approvals/evaluate${date ? `?date=${date}` : ''}`),
  approve: (id, note) => post(`/Attendance/approvals/${id}/approve`, { note }),
  reject: (id, note) => post(`/Attendance/approvals/${id}/reject`, { note }),
  approveMany: (approvalIds, note) =>
    post('/Attendance/approvals/approve-many', { approvalIds, note }),
}

// ── Biometric enrolment ──────────────────────────────────────
// Getting a person who exists here to also exist on the terminals.
// `start` is what makes the ZKTeco screen switch to "place finger" /
// open the face-registration camera for this employee.
export const enrollment = {
  status: (employeeId) => get(`/Employees/${employeeId}/enrollment/status`),
  pushUser: (employeeId, deviceId) =>
    post(`/Employees/${employeeId}/enrollment/push-user${deviceId ? `?deviceId=${deviceId}` : ''}`),
  start: (employeeId, { deviceId, fingerIndex = 0 } = {}) => {
    const q = new URLSearchParams()
    if (deviceId) q.set('deviceId', deviceId)
    q.set('fingerIndex', String(fingerIndex))
    return post(`/Employees/${employeeId}/enrollment/start?${q}`)
  },
  cancel: (employeeId, deviceId) =>
    post(`/Employees/${employeeId}/enrollment/cancel${deviceId ? `?deviceId=${deviceId}` : ''}`),
  propagate: (employeeId) => post(`/Employees/${employeeId}/enrollment/propagate`),
  provisionDevice: (deviceId) => post(`/Devices/${deviceId}/provision`),
  reconcileAll: (deviceId = 0) => post(`/Devices/${deviceId}/reconcile-all`),
}

// ── Notifications ────────────────────────────────────────────
export const notifications = {
  list: (params) => get('/Notifications', params),
  unreadCount: () => get('/Notifications/unread-count'),
  markRead: (id) => post(`/Notifications/${id}/read`),
  markAllRead: () => post('/Notifications/read-all'),
}

// ── Attendance ───────────────────────────────────────────────
export const attendance = {
  log: (params) => get('/Attendance/log', params),
  logFilters: () => get('/Attendance/log/filters'),
  my: (params) => get('/Attendance/my', params),
  mySummary: () => get('/Attendance/my-summary'),
  holidaysUpcoming: (days = 90) => get('/Attendance/holidays/upcoming', { days }),
  manual: (b) => post('/Attendance/manual', b),
  punches: (params) => get('/Attendance/punches', params),
  deletePunch: (logId) => del(`/Attendance/punches/${logId}`),
  purge: (params) => post(`/Attendance/punches/purge?${new URLSearchParams(params)}`),
  day: (employeeId, date) => get('/Attendance/day', { employeeId, date }),
}

// ── Overview (pivot) ─────────────────────────────────────────
export const overview = {
  get: (params) => get('/Overview', params),
  summary: (params) => get('/Overview/summary', params),
}

// ── Holidays ─────────────────────────────────────────────────
export const holidays = {
  list: (params) => get('/Holidays', params),
  create: (b) => post('/Holidays', b),
  removeOnDate: (date) => del(`/Holidays/on/${date}`),
}

// ── Error log ────────────────────────────────────────────────
export const errorLog = {
  list: (params) => get('/ErrorLog', params),
  openCount: () => get('/ErrorLog/open-count'),
  resolve: (id, resolution) => post(`/ErrorLog/${id}/resolve`, { resolution }),
  clearResolved: () => post('/ErrorLog/clear-resolved'),
}

// ── Reports ──────────────────────────────────────────────────
export const reports = {
  daily: (params) => get('/Reports/daily', params),
  range: (params) => get('/Reports/range', params),
  dailySummary: (params) => get('/Reports/daily-summary', params),
}

// ── Account / users ──────────────────────────────────────────
export const account = {
  profile: () => get('/Account/profile'),
  changePassword: (b) => post('/Account/change-password', b),
}

export const users = {
  list: () => get('/Users'),
  setActive: (id, active) => post(`/Users/${id}/set-active?active=${active}`),
  setRole: (id, role) => post(`/Users/${id}/set-role?role=${role}`),
}

// ── Dashboard ────────────────────────────────────────────────
export const dashboard = {
  summary: () => get('/Dashboard/summary'),
}

// ── Leave Requests ───────────────────────────────────────────
export const leaveRequests = {
  list: (params) => get('/LeaveRequests', params),
  getById: (id) => get(`/LeaveRequests/${id}`),
  create: (b) => post('/LeaveRequests', b),
  update: (id, b) => put(`/LeaveRequests/${id}`, b),
  submit: (id) => post(`/LeaveRequests/${id}/submit`),
  delete: (id) => del(`/LeaveRequests/${id}`),
  approve: (id, remarks) => post(`/LeaveRequests/${id}/approve`, { remarks }),
  reject: (id, remarks) => post(`/LeaveRequests/${id}/reject`, { remarks }),
  summary: (params) => get('/LeaveRequests/summary', params),
}

