import { useEffect, useState } from 'react'
import { settings as api } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { PageHeader, Card, Button, Toggle } from '../components/ui'
import { useFeedback } from '../components/feedback'
import { useAuth } from '../context/AuthContext'

export default function Settings() {
  const fb = useFeedback()
  const { role } = useAuth()
  const isAdmin = role === 'Admin'

  const [mail, setMail] = useState(null)
  const [mailError, setMailError] = useState('')
  const [testTo, setTestTo] = useState('')
  const [mailBusy, setMailBusy] = useState('')

  useEffect(() => {
    api
      .email()
      // password is never sent back, so track it separately
      .then((m) => {
        setMail({ ...m, password: '' })
        setMailError('')
      })
      .catch((e) => {
        // Hiding the card on failure meant the section simply vanished with no
        // explanation, which is worse than showing the reason.
        setMail(null)
        setMailError(
          e?.response?.status === 404
            ? 'The email settings endpoint was not found. The API is running an older build, so rebuild and restart it.'
            : apiErrorMessage(e),
        )
      })
  }, [])

  const setMailField = (key) => (value) => setMail((m) => ({ ...m, [key]: value }))

  async function saveMail(e) {
    e.preventDefault()
    setMailBusy('save')
    try {
      const res = await api.saveEmail(mail)
      setMail((m) => ({ ...m, password: '', passwordIsSet: m.password ? true : m.passwordIsSet, configured: res.configured }))
      fb.success(res.message)
    } catch (err) {
      fb.error(apiErrorMessage(err))
    } finally {
      setMailBusy('')
    }
  }

  async function sendTest() {
    if (!testTo.trim()) {
      fb.error('Enter an address to send the test to.')
      return
    }
    setMailBusy('test')
    try {
      const res = await api.testEmail(testTo.trim())
      fb.success(res.message)
    } catch (err) {
      fb.error(apiErrorMessage(err))
    } finally {
      setMailBusy('')
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader title="Settings" subtitle="Office hours and attendance rules" />

      <Card className="p-6 border-sky-100 bg-gradient-to-r from-sky-50/70 via-blue-50/40 to-slate-50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              Work Shifts & Attendance Timing Rules
            </h2>
            <p className="text-sm text-slate-600 max-w-2xl">
              Working hours, start and end times, grace periods, and half-day thresholds are now configured per <strong>Work Shift</strong>. You can define specific shifts for different employee groups or individual staff members.
            </p>
          </div>
          <a
            href="/shifts"
            className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-sky-500 transition shrink-0"
          >
            Manage Work Shifts
          </a>
        </div>
      </Card>

      {/* Email. Needed before any attendance email can go out. */}
      {isAdmin && !mail && (
        <Card className="mt-4 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Email (SMTP)</h2>
          <p className="mt-2 text-sm text-amber-800">
            {mailError || 'Loading...'}
          </p>
        </Card>
      )}

      {!isAdmin && (
        <Card className="mt-4 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Email (SMTP)</h2>
          <p className="mt-2 text-sm text-slate-500">
            Only an admin can view or change the email settings.
          </p>
        </Card>
      )}

      {isAdmin && mail && (
        <form onSubmit={saveMail} className="mt-4 space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Email (SMTP)</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                  mail.configured
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : 'bg-amber-50 text-amber-700 ring-amber-200'
                }`}
              >
                {mail.configured ? 'Configured' : 'Not configured'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Used for the daily attendance emails. For Gmail use an app password.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="SMTP host"
                value={mail.smtpHost || ''}
                onChange={setMailField('smtpHost')}
                placeholder="smtp.gmail.com"
              />
              <TextField
                label="Port"
                type="number"
                value={mail.smtpPort ?? 587}
                onChange={(v) => setMailField('smtpPort')(Number(v))}
                placeholder="587"
              />
              <TextField
                label="Username"
                value={mail.username || ''}
                onChange={setMailField('username')}
                placeholder="attendance@company.com"
              />
              <TextField
                label={mail.passwordIsSet ? 'Password (leave blank to keep)' : 'Password'}
                type="password"
                value={mail.password || ''}
                onChange={setMailField('password')}
                placeholder={mail.passwordIsSet ? '••••••••' : 'app password'}
              />
              <TextField
                label="From address"
                value={mail.fromAddress || ''}
                onChange={setMailField('fromAddress')}
                placeholder="attendance@company.com"
              />
              <TextField
                label="From name"
                value={mail.fromName || ''}
                onChange={setMailField('fromName')}
                placeholder="Attendance System"
              />
            </div>

            <div className="mt-4">
              <Toggle
                label="Use SSL/TLS"
                checked={mail.useSsl !== false}
                onChange={setMailField('useSsl')}
                hint="Leave on for port 587 or 465"
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@company.com"
                  className="input w-56"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={sendTest}
                  disabled={Boolean(mailBusy) || !mail.configured}
                  title={mail.configured ? undefined : 'Save the settings first'}
                >
                  {mailBusy === 'test' ? 'Sending...' : 'Send test'}
                </Button>
              </div>
              <Button type="submit" disabled={Boolean(mailBusy)}>
                {mailBusy === 'save' ? 'Saving...' : 'Save email settings'}
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  )
}

function TextField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full"
      />
    </label>
  )
}
