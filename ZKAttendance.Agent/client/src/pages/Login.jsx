import { useState } from 'react'
import { auth, errorText } from '../api'

/**
 * The credentials are checked by App1, not here. The agent has no user table
 * of its own, which is the point: one place to add or remove a person.
 */
export default function Login({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await auth.login(form.username, form.password)
      sessionStorage.setItem('agent_token', res.token)
      sessionStorage.setItem('agent_user', JSON.stringify({ username: res.username, role: res.role }))
      onLogin({ username: res.username, role: res.role })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-3">
          <img src="/favicon.png" alt="Danfe Logo" className="h-10 w-10 rounded-xl bg-white p-1 object-contain shadow-xs ring-1 ring-slate-200" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Attendance Agent</h1>
            <p className="text-xs text-slate-500">Sign in with your central server account.</p>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
            {error}
          </p>
        )}

        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Username</span>
          <input
            className="input"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            autoFocus
            required
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            className="input"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>

        <button type="submit" className="btn mt-5 w-full" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="mt-4 text-xs text-slate-400">
          This agent reads the ZKTeco devices on this network. It does not store attendance itself.
        </p>
      </form>
    </div>
  )
}
