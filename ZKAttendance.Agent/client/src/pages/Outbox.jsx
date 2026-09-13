import { useCallback, useEffect, useState } from 'react'
import { agent, errorText, dt } from '../api'

const TABS = [
  { id: 'Pending', label: 'Pending Queue' },
  { id: 'Dead', label: 'Failed (Dead)' },
  { id: 'Sent', label: 'Delivered (Sent)' },
]

/**
 * Failed / Pending Sync page.
 * Punches land here first upon reading from terminal, and background drain forwards to Central.
 */
export default function Outbox() {
  const [tab, setTab] = useState('Pending')
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(() => {
    agent.outbox(tab).then(setData).catch(() => setData({ rows: [] }))
  }, [tab])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  async function drain() {
    setBusy('drain')
    setNote('')
    try {
      const r = await agent.drain()
      setNote(`Drain completed: ${r.pending} still waiting.`)
      load()
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy('')
    }
  }

  async function retry() {
    setBusy('retry')
    try {
      const r = await agent.retryDead()
      setNote(`${r.requeued} dead records re-queued for delivery.`)
      load()
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy('')
    }
  }

  async function handleClear() {
    if (!window.confirm('Clear all pending, sent, and failed records from the local outbox? This is useful to remove mock simulation data.')) {
      return
    }
    setBusy('clear')
    try {
      const r = await agent.clearOutbox()
      setNote(r.message || 'Outbox buffer cleared.')
      load()
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Failed / Pending Sync</h1>
          <p className="text-xs text-slate-500">
            Local SQLite/SQL punch buffer. Queued offline records are forwarded to central database automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost !px-3 !py-1.5 !text-xs text-slate-500 hover:text-rose-700 hover:bg-rose-50 font-medium"
            onClick={handleClear}
            disabled={Boolean(busy) || (!data?.pending && !data?.dead && !data?.sent)}
            title="Remove mock or old records from local buffer"
          >
            {busy === 'clear' ? 'Clearing...' : 'Clear Buffer'}
          </button>
          <button className="btn !px-3 !py-1.5 !text-xs font-semibold" onClick={drain} disabled={Boolean(busy)}>
            {busy === 'drain' ? 'Draining...' : 'Send Pending Now'}
          </button>
          <button
            className="btn-ghost !px-3 !py-1.5 !text-xs text-rose-700 hover:bg-rose-50 font-semibold"
            onClick={retry}
            disabled={Boolean(busy) || !data?.dead}
          >
            {busy === 'retry' ? 'Re-queueing...' : 'Retry Failed'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Waiting in Queue" value={data?.pending ?? 0} tone="amber" subtitle="Pending transmission" />
        <Stat label="Failed / Dead" value={data?.dead ?? 0} tone="rose" subtitle="Rejected by central" />
        <Stat label="Confirmed Delivered" value={data?.sent ?? 0} tone="emerald" subtitle="Successfully synced" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2 rounded-xl border border-slate-200">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-3 py-1.5 transition ${
                tab === t.id ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
              {t.id === 'Pending' && data?.pending > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {data.pending}
                </span>
              )}
              {t.id === 'Dead' && data?.dead > 0 && (
                <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {data.dead}
                </span>
              )}
            </button>
          ))}
        </div>

        <span className="text-[11px] text-slate-500 px-2 font-medium">
          {note || 'Auto-flushes every 20 seconds in background.'}
        </span>
      </div>

      <section className="card overflow-hidden shadow-xs">
        {!data ? (
          <p className="py-12 text-center text-xs text-slate-400">Loading punch records...</p>
        ) : data.rows.length === 0 ? (
          <p className="py-12 text-center text-xs text-slate-400">
            {tab === 'Pending'
              ? 'No pending punches. All read logs have been sent to central.'
              : tab === 'Dead'
                ? 'No failed punches. Central has accepted all records without rejection.'
                : 'No delivered records in view.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Enrol No.</th>
                  <th className="px-4 py-3">Punch Time</th>
                  <th className="px-4 py-3">Device ID</th>
                  <th className="px-4 py-3">Tries</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Detail / Error Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.outboxId} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800">{r.biometricUserId}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{dt(r.punchTime)}</td>
                    <td className="px-4 py-3 text-slate-500">Terminal #{r.deviceId}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-slate-600">{r.attempts}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.status === 'Sent'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : r.status === 'Dead'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-600 max-w-xs truncate">
                      {r.lastError || (r.sentAt ? `Delivered at ${dt(r.sentAt)}` : 'Waiting for drain cycle')}
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

function Stat({ label, value, tone, subtitle }) {
  const colour = { amber: 'text-amber-600', emerald: 'text-emerald-700', rose: 'text-rose-600' }[tone]
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold tabular-nums ${value ? colour : 'text-slate-800'}`}>
        {value}
      </div>
      {subtitle && <div className="mt-0.5 text-[10px] text-slate-400">{subtitle}</div>}
    </div>
  )
}
