import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { auth, agent } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import ManualSync from './pages/ManualSync'
import SyncHistory from './pages/SyncHistory'
import Outbox from './pages/Outbox'
import Reports from './pages/Reports'

export default function App() {
  const [user, setUser] = useState(() => {
    const raw = sessionStorage.getItem('agent_user')
    return raw ? JSON.parse(raw) : null
  })
  const [status, setStatus] = useState(null)

  // Poll the link state so the header is honest about whether the central
  // server is reachable. Punches keep queueing either way.
  useEffect(() => {
    if (!user) return
    let alive = true
    const tick = () => agent.status().then((s) => alive && setStatus(s)).catch(() => {})
    tick()
    const id = setInterval(tick, 15000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [user])

  if (!user) return <Login onLogin={setUser} />

  return (
    <div className="min-h-screen bg-slate-50">
      <Header user={user} status={status} onLogout={() => { sessionStorage.clear(); setUser(null) }} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard status={status} />} />
          <Route path="/devices" element={<Devices status={status} />} />
          <Route path="/sync" element={<Navigate to="/devices" replace />} />
          <Route path="/history" element={<SyncHistory />} />
          <Route path="/outbox" element={<Outbox />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Header({ user, status, onLogout }) {
  const navigate = useNavigate()
  const pending = status?.outbox?.pending ?? 0
  const dead = status?.outbox?.dead ?? 0

  return (
    <header className="border-b border-slate-800 bg-slate-900 sticky top-0 z-40 shadow-md text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <button onClick={() => navigate('/dashboard')} className="text-left group flex items-center gap-3">
          <div>
            <div className="text-base font-bold tracking-tight text-white group-hover:text-sky-300 transition">
              ZK<span className="text-sky-400"> Agent</span>
            </div>
          </div>
        </button>

        <nav className="flex flex-wrap gap-1 text-sm font-medium">
          <Tab to="/dashboard">Dashboard</Tab>
          <Tab to="/devices">Devices</Tab>
          <Tab to="/history">Sync History</Tab>
          <Tab to="/outbox">
            Outbox
            {pending > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white shadow-xs">
                {pending}
              </span>
            )}
            {dead > 0 && (
              <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-bold text-white shadow-xs">
                {dead}
              </span>
            )}
          </Tab>
          <Tab to="/reports">Reports</Tab>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ConnectionPill status={status} />

          {/* Circle with A for Admin and username */}
          <div className="flex items-center gap-2 pl-1">
            <div
              className="h-8 w-8 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs ring-2 ring-slate-700 shadow-sm flex-shrink-0 select-none"
              title="Admin User"
            >
              A
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-semibold text-slate-200 leading-tight truncate max-w-[120px]">
                {user.username}
              </div>
              <div className="text-[10px] font-medium text-sky-400 leading-tight">Admin</div>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-rose-400 transition"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}

function Tab({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          isActive
            ? 'bg-sky-600 text-white shadow-xs'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function ConnectionPill({ status }) {
  if (!status)
    return (
      <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
        checking
      </span>
    )

  if (!status.configured)
    return (
      <span className="rounded-full bg-rose-500/20 border border-rose-500/30 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
        not configured
      </span>
    )

  return status.connected ? (
    <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> connected
    </span>
  ) : (
    <span className="rounded-full bg-rose-500/20 border border-rose-500/40 px-2.5 py-0.5 text-xs font-semibold text-rose-300 flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> offline
    </span>
  )
}
