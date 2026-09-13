import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { agent, errorText, dt } from '../api'

export default function SyncHistory() {
  const [searchParams] = useSearchParams()
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterDevice, setFilterDevice] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')

  // Detailed modal state
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [details, setDetails] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  const loadRuns = useCallback(() => {
    setLoading(true)
    setError('')
    agent.runs()
      .then((data) => setRuns(data || []))
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // Check URL param runId
  useEffect(() => {
    const rId = searchParams.get('runId')
    if (rId) {
      viewDetails(Number(rId))
    }
  }, [searchParams])

  async function viewDetails(runId) {
    setSelectedRunId(runId)
    setDetails(null)
    setLoadingDetails(true)
    try {
      const data = await agent.runDetails(runId)
      setDetails(data)
    } catch (e) {
      setDetails({ error: errorText(e) })
    } finally {
      setLoadingDetails(false)
    }
  }

  const deviceNames = Array.from(new Set(runs.map((r) => r.deviceName).filter(Boolean)))

  const filteredRuns = runs.filter((r) => {
    if (filterDevice !== 'All' && r.deviceName !== filterDevice) return false
    if (filterStatus !== 'All' && r.status !== filterStatus) return false
    return true
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sync History</h1>
          <p className="text-xs text-slate-500">
            Log of all terminal sync runs and punch staging workflows.
          </p>
        </div>
        <button className="btn-ghost !px-3 !py-1.5 !text-xs font-medium" onClick={loadRuns}>
          Refresh History
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
          {error}
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 text-xs">
        <div className="flex items-center gap-2">
          <label className="font-semibold text-slate-600">Filter Device:</label>
          <select
            className="input !py-1 text-xs"
            value={filterDevice}
            onChange={(e) => setFilterDevice(e.target.value)}
          >
            <option value="All">All Terminals</option>
            {deviceNames.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="font-semibold text-slate-600">Status:</label>
          <select
            className="input !py-1 text-xs"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="All">All Statuses</option>
            <option value="Success">Success Only</option>
            <option value="Failed">Failed Only</option>
            <option value="Running">Running</option>
          </select>
        </div>

        <div className="ml-auto text-slate-400 font-medium">
          Showing {filteredRuns.length} of {runs.length} runs
        </div>
      </div>

      {/* Runs Table */}
      <section className="card overflow-hidden shadow-xs">
        {loading ? (
          <p className="py-12 text-center text-xs text-slate-400">Loading sync history...</p>
        ) : filteredRuns.length === 0 ? (
          <p className="py-12 text-center text-xs text-slate-400">No sync runs match your filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left font-medium text-slate-500 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-4 py-3">Run ID</th>
                  <th className="px-4 py-3">Device</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Records Read</th>
                  <th className="px-4 py-3">Records Staged</th>
                  <th className="px-4 py-3">Records Sent</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRuns.map((r) => (
                  <tr
                    key={r.syncRunId}
                    className="hover:bg-slate-50/70 transition cursor-pointer"
                    onClick={() => viewDetails(r.syncRunId)}
                  >
                    <td className="px-4 py-3 font-mono text-slate-400">#{r.syncRunId}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{r.deviceName}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{dt(r.startedAt)}</td>
                    <td className="px-4 py-3 tabular-nums font-medium text-slate-800">
                      {r.recordsRead}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-bold text-sky-700">
                      {r.recordsStaged ?? r.recordsQueued}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-bold text-emerald-700">
                      {r.recordsSent ?? 0}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-bold text-rose-600">
                      {r.recordsDead ?? (r.status === 'Failed' ? 1 : 0)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.status === 'Success'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : r.status === 'Failed'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="btn-ghost !px-2.5 !py-1 !text-xs font-semibold text-sky-600 hover:text-sky-800"
                        onClick={(e) => {
                          e.stopPropagation()
                          viewDetails(r.syncRunId)
                        }}
                      >
                        Details →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sync Details Modal */}
      {selectedRunId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-3xl max-h-[90vh] flex flex-col p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Sync Run Details: #{selectedRunId}
                </h3>
                {details && !details.error && (
                  <p className="text-xs text-slate-500">
                    Device: <span className="font-semibold text-slate-800">{details.deviceName}</span> ·
                    Started: <span className="tabular-nums">{dt(details.startedAt)}</span>
                    {details.finishedAt ? ` · Finished: ${dt(details.finishedAt)}` : ''}
                  </p>
                )}
              </div>
              <button
                className="text-slate-400 hover:text-slate-600 text-xl font-bold leading-none"
                onClick={() => setSelectedRunId(null)}
              >
                ×
              </button>
            </div>

            {loadingDetails ? (
              <p className="py-12 text-center text-xs text-slate-400">Loading run metrics & punch records...</p>
            ) : details?.error ? (
              <div className="rounded-lg bg-rose-50 p-4 text-xs text-rose-700 border border-rose-200">
                {details.error}
              </div>
            ) : details ? (
              <div className="space-y-4 overflow-y-auto pr-1">
                {/* 5 Core Metrics Cards: Read, Staged, Sent, Failed, Errors */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div className="card p-3 border-t-2 border-slate-400 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      1. Records Read
                    </div>
                    <div className="mt-1 text-xl font-extrabold text-slate-800 tabular-nums">
                      {details.recordsRead}
                    </div>
                    <div className="text-[10px] text-slate-400">From Terminal</div>
                  </div>

                  <div className="card p-3 border-t-2 border-sky-500 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-sky-600">
                      2. Records Staged
                    </div>
                    <div className="mt-1 text-xl font-extrabold text-sky-700 tabular-nums">
                      {details.recordsStaged}
                    </div>
                    <div className="text-[10px] text-slate-400">In Local Outbox</div>
                  </div>

                  <div className="card p-3 border-t-2 border-emerald-500 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                      3. Records Sent
                    </div>
                    <div className="mt-1 text-xl font-extrabold text-emerald-700 tabular-nums">
                      {details.recordsSent}
                    </div>
                    <div className="text-[10px] text-slate-400">Delivered to Central</div>
                  </div>

                  <div className="card p-3 border-t-2 border-rose-500 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
                      4. Failed
                    </div>
                    <div className="mt-1 text-xl font-extrabold text-rose-700 tabular-nums">
                      {details.recordsDead}
                    </div>
                    <div className="text-[10px] text-slate-400">Dead / Rejected</div>
                  </div>

                  <div className="card p-3 border-t-2 border-amber-500 text-center col-span-2 sm:col-span-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                      5. Pending
                    </div>
                    <div className="mt-1 text-xl font-extrabold text-amber-700 tabular-nums">
                      {details.recordsPending}
                    </div>
                    <div className="text-[10px] text-slate-400">In Drain Queue</div>
                  </div>
                </div>

                {/* Execution Message & Errors */}
                <div className="card p-3.5 bg-slate-50 text-xs space-y-1">
                  <div className="font-semibold text-slate-800">Status & Error Log:</div>
                  <div className="text-slate-600">{details.message || 'Run finished without errors.'}</div>
                </div>

                {/* Staged Punch Records Table */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">
                      Staged Punches in this Run ({details.punches?.length || 0})
                    </span>
                    <span className="text-slate-400 text-[11px]">Recent 200 items</span>
                  </div>

                  {!details.punches || details.punches.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400">
                      No new punch rows were staged in this run (terminal had no unrecorded logs).
                    </p>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-100 text-left text-[10px] font-semibold uppercase text-slate-500 sticky top-0">
                          <tr>
                            <th className="px-3 py-2">Enrol No</th>
                            <th className="px-3 py-2">Punch Time</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Tries</th>
                            <th className="px-3 py-2">Error / Delivery Info</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {details.punches.map((p) => (
                            <tr key={p.outboxId} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-mono font-medium">{p.biometricUserId}</td>
                              <td className="px-3 py-2 tabular-nums text-slate-600">{dt(p.punchTime)}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                                    p.status === 'Sent'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : p.status === 'Dead'
                                        ? 'bg-rose-50 text-rose-700'
                                        : 'bg-amber-50 text-amber-700'
                                  }`}
                                >
                                  {p.status}
                                </span>
                              </td>
                              <td className="px-3 py-2 tabular-nums text-slate-500">{p.attempts}</td>
                              <td className="px-3 py-2 text-[11px] text-slate-500">
                                {p.lastError || (p.sentAt ? `Delivered ${dt(p.sentAt)}` : 'Waiting to drain')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button className="btn !px-4 !py-1.5 text-xs" onClick={() => setSelectedRunId(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
