import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { agent, errorText, dt } from '../api'

export default function Dashboard({ status }) {
  const navigate = useNavigate()
  const [devices, setDevices] = useState([])
  const [runs, setRuns] = useState([])
  const [outbox, setOutbox] = useState(null)
  const [testingId, setTestingId] = useState(null)
  const [testResults, setTestResults] = useState({})
  const [syncingId, setSyncingId] = useState(null)
  const [syncAllBusy, setSyncAllBusy] = useState(false)
  const [actionNote, setActionNote] = useState('')
  const [draining, setDraining] = useState(false)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    agent.devices().then((d) => setDevices(d.devices || [])).catch(() => {})
    agent.runs().then((r) => setRuns(r.slice(0, 5))).catch(() => {})
    agent.outbox('Pending').then(setOutbox).catch(() => {})
  }, [])

  async function handleTest(deviceId) {
    setTestingId(deviceId)
    try {
      const res = await agent.testConnection(deviceId)
      setTestResults((prev) => ({ ...prev, [deviceId]: res }))
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [deviceId]: { success: false, message: errorText(e) }
      }))
    } finally {
      setTestingId(null)
    }
  }

  async function handleSingleSync(device) {
    setSyncingId(device.deviceId)
    setActionNote('')
    try {
      const res = await agent.sync(device.deviceId)
      setActionNote(`${device.deviceName}: ${res.message}`)
      agent.runs().then((r) => setRuns(r.slice(0, 5))).catch(() => {})
      agent.outbox('Pending').then(setOutbox).catch(() => {})
    } catch (e) {
      setActionNote(`${device.deviceName} sync failed: ${errorText(e)}`)
    } finally {
      setSyncingId(null)
    }
  }

  async function handleSyncAll() {
    if (devices.length === 0) return
    setSyncAllBusy(true)
    setActionNote('Syncing all devices...')

    let totalRead = 0
    let totalQueued = 0

    for (const d of devices) {
      try {
        const res = await agent.sync(d.deviceId)
        totalRead += res.recordsRead || 0
        totalQueued += res.recordsQueued || 0
      } catch (e) {
        // continue with other devices
      }
    }

    setActionNote(`Sync complete! Read ${totalRead} logs across all terminals, queued ${totalQueued} in outbox.`)
    setSyncAllBusy(false)
    agent.runs().then((r) => setRuns(r.slice(0, 5))).catch(() => {})
    agent.outbox('Pending').then(setOutbox).catch(() => {})
  }

  async function handleDrain() {
    setDraining(true)
    setActionNote('')
    try {
      const r = await agent.drain()
      setActionNote(`Outbox drain completed: ${r.pending} still waiting.`)
      agent.outbox('Pending').then(setOutbox).catch(() => {})
    } catch (e) {
      setActionNote(errorText(e))
    } finally {
      setDraining(false)
    }
  }

  async function handleRetryDead() {
    setRetrying(true)
    setActionNote('')
    try {
      const r = await agent.retryDead()
      setActionNote(`${r.requeued} dead records re-queued.`)
      agent.outbox('Pending').then(setOutbox).catch(() => {})
    } catch (e) {
      setActionNote(errorText(e))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="card p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight">
                {status?.serverName || 'Local Attendance Agent'}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  status?.connected
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}
              >
                {status?.connected ? '● Central Connected' : '○ Offline / Standalone'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Branch: <span className="text-slate-200 font-medium">{status?.branchName || 'Head Office'}</span> ·
              Central Server: <span className="font-mono text-slate-300">{status?.centralUrl || 'Not configured'}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncAll}
              disabled={syncAllBusy || devices.length === 0}
              className="btn !bg-sky-500 hover:!bg-sky-400 !text-white font-semibold !text-xs !py-2 shadow-sm"
            >
              {syncAllBusy ? 'Syncing All...' : '⚡ Sync All Devices'}
            </button>
          </div>
        </div>
      </div>

      {actionNote && (
        <div className="rounded-lg bg-sky-50 border border-sky-200 px-4 py-2.5 text-xs font-medium text-sky-800">
          {actionNote}
        </div>
      )}

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card p-4 border-l-4 border-amber-500">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Waiting in Outbox</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-amber-600 tabular-nums">
              {outbox?.pending ?? status?.outbox?.pending ?? 0}
            </span>
            <button
              onClick={handleDrain}
              disabled={draining || (outbox?.pending ?? 0) === 0}
              className="btn !px-2.5 !py-1 !text-xs disabled:opacity-40"
            >
              {draining ? 'Sending...' : 'Send Now'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Auto-flushes every 20s to Central</p>
        </div>

        <div className="card p-4 border-l-4 border-emerald-500">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Sent to Central</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-emerald-600 tabular-nums">
              {outbox?.sent ?? status?.outbox?.sent ?? 0}
            </span>
            <Link to="/outbox" className="text-xs text-slate-500 hover:text-emerald-700 font-medium">
              View →
            </Link>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Confirmed saved in central database</p>
        </div>

        <div className="card p-4 border-l-4 border-rose-500">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Failed Records</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-rose-600 tabular-nums">
              {outbox?.dead ?? status?.outbox?.dead ?? 0}
            </span>
            <button
              onClick={handleRetryDead}
              disabled={retrying || (outbox?.dead ?? 0) === 0}
              className="btn-ghost !px-2.5 !py-1 !text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Rejected punches</p>
        </div>

        <div className="card p-4 border-l-4 border-sky-500">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Terminals</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-sky-700 tabular-nums">
              {devices.length}
            </span>
            <Link to="/devices" className="text-xs text-slate-500 hover:text-sky-700 font-medium">
              Manage →
            </Link>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Active biometric readers</p>
        </div>
      </div>

      {/* Streamlined Terminals Table with 1-Click Sync */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Terminals & 1-Click Sync</h2>
            <p className="text-xs text-slate-400">Click Sync on any device to read new punches immediately</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/devices" className="btn-ghost !px-2.5 !py-1 !text-xs text-slate-600">
              Manage Devices →
            </Link>
            <button
              onClick={handleSyncAll}
              disabled={syncAllBusy || devices.length === 0}
              className="btn !px-3 !py-1 !text-xs font-semibold"
            >
              {syncAllBusy ? 'Syncing...' : 'Sync All'}
            </button>
          </div>
        </div>

        {devices.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">No terminals assigned to this agent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-medium text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Terminal</th>
                  <th className="px-4 py-2.5">LAN Address</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Reachability</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.map((d) => {
                  const test = testResults[d.deviceId]
                  const isTesting = testingId === d.deviceId
                  const isSyncing = syncingId === d.deviceId

                  return (
                    <tr key={d.deviceId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-semibold text-slate-800">{d.deviceName}</td>
                      <td className="px-4 py-3 font-mono text-slate-600 tabular-nums">
                        {d.deviceIP}:{d.devicePort}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            d.role === 'Master' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {d.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {test ? (
                          <span
                            className={`font-semibold ${
                              test.success ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {test.success ? '✓ Online' : '✗ Unreachable'}
                          </span>
                        ) : (
                          <span className="text-slate-400">Not checked</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1.5">
                        <button
                          onClick={() => handleTest(d.deviceId)}
                          disabled={isTesting}
                          className="btn-ghost !px-2.5 !py-1 !text-xs text-slate-600"
                        >
                          {isTesting ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          onClick={() => handleSingleSync(d)}
                          disabled={isSyncing}
                          className="btn !px-3 !py-1 !text-xs font-semibold"
                        >
                          {isSyncing ? 'Syncing...' : 'Sync'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Sync History */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent Sync History</h2>
            <p className="text-xs text-slate-400">Latest manual and automated runs</p>
          </div>
          <Link to="/history" className="text-xs font-semibold text-sky-600 hover:text-sky-700">
            View All History →
          </Link>
        </div>

        {runs.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">No sync runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5">Device</th>
                  <th className="px-4 py-2.5">Time</th>
                  <th className="px-4 py-2.5">Read</th>
                  <th className="px-4 py-2.5">Staged</th>
                  <th className="px-4 py-2.5">Sent</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.syncRunId} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.deviceName}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{dt(r.startedAt)}</td>
                    <td className="px-4 py-2.5 tabular-nums font-medium">{r.recordsRead}</td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold text-sky-700">
                      {r.recordsStaged ?? r.recordsQueued}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold text-emerald-700">
                      {r.recordsSent ?? 0}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          r.status === 'Success'
                            ? 'bg-emerald-50 text-emerald-700'
                            : r.status === 'Failed'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        to={`/history?runId=${r.syncRunId}`}
                        className="text-sky-600 hover:text-sky-800 font-medium"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
