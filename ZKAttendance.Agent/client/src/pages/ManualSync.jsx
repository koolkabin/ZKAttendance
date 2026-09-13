import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { agent, errorText, dt } from '../api'

export default function ManualSync({ status }) {
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [datePreset, setDatePreset] = useState('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [busy, setBusy] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    agent.devices().then((d) => {
      const list = d.devices || []
      setDevices(list)
      if (list.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(String(list[0].deviceId))
      }
    }).catch((e) => setError(errorText(e)))
  }, [])

  function computeDateRange() {
    let from = null
    let to = null
    const today = new Date()

    if (datePreset === 'today') {
      from = today.toISOString().slice(0, 10)
    } else if (datePreset === 'yesterday') {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      from = y.toISOString().slice(0, 10)
    } else if (datePreset === '7d') {
      const d7 = new Date(today)
      d7.setDate(d7.getDate() - 7)
      from = d7.toISOString().slice(0, 10)
    } else if (datePreset === '30d') {
      const d30 = new Date(today)
      d30.setDate(d30.getDate() - 30)
      from = d30.toISOString().slice(0, 10)
    } else if (datePreset === 'month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
      from = firstDay.toISOString().slice(0, 10)
    } else if (datePreset === 'custom') {
      from = customFrom || null
      to = customTo || null
    }

    return { from, to }
  }

  async function handleStartSync(e) {
    e.preventDefault()
    if (!selectedDeviceId) return

    setBusy(true)
    setResults([])
    setError('')
    const { from, to } = computeDateRange()

    const targetDevices = selectedDeviceId === 'all'
      ? devices
      : devices.filter((d) => String(d.deviceId) === selectedDeviceId)

    if (targetDevices.length === 0) {
      setError('No devices available to sync.')
      setBusy(false)
      return
    }

    const runResults = []

    for (let i = 0; i < targetDevices.length; i++) {
      const dev = targetDevices[i]
      setProgressMsg(`[${i + 1}/${targetDevices.length}] Connecting to ${dev.deviceName} (${dev.deviceIP})...`)

      try {
        const run = await agent.sync(dev.deviceId, { fromDate: from, toDate: to })
        runResults.push(run)
      } catch (err) {
        runResults.push({
          status: 'Failed',
          deviceName: dev.deviceName,
          message: errorText(err),
          recordsRead: 0,
          recordsQueued: 0,
        })
      }
    }

    setProgressMsg('')
    setResults(runResults)
    setBusy(false)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Manual Device Sync</h1>
          <p className="text-xs text-slate-500">
            Pull punches directly from ZKTeco biometric terminals into the local outbox.
          </p>
        </div>
        <Link to="/history" className="text-xs font-semibold text-sky-600 hover:text-sky-700">
          View Sync History →
        </Link>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-4 text-xs text-rose-700 border border-rose-200">
          {error}
        </div>
      )}

      {status && !status.connected && (
        <div className="rounded-lg bg-amber-50 p-4 text-xs text-amber-800 border border-amber-200">
          <b>Offline notice:</b> Cannot reach the central server right now. You can still sync punches from local devices. All records will be stored in the local outbox and forwarded when the link is restored.
        </div>
      )}

      <div className="card p-6 shadow-sm">
        <form onSubmit={handleStartSync} className="space-y-6">
          {/* Step 1: Select Device */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700 font-bold text-xs">
                1
              </span>
              <label className="text-sm font-semibold text-slate-800">Select Biometric Device</label>
            </div>

            {devices.length === 0 ? (
              <p className="text-xs text-slate-400">No active devices registered for this branch.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <label
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${
                    selectedDeviceId === 'all'
                      ? 'border-sky-500 bg-sky-50/50 ring-1 ring-sky-500'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="deviceChoice"
                      value="all"
                      checked={selectedDeviceId === 'all'}
                      onChange={() => setSelectedDeviceId('all')}
                      className="text-sky-600"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-800">All Registered Devices</div>
                      <div className="text-[11px] text-slate-500">Sync all {devices.length} terminals in sequence</div>
                    </div>
                  </div>
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                    Batch
                  </span>
                </label>

                {devices.map((d) => (
                  <label
                    key={d.deviceId}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${
                      selectedDeviceId === String(d.deviceId)
                        ? 'border-sky-500 bg-sky-50/50 ring-1 ring-sky-500'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="deviceChoice"
                        value={d.deviceId}
                        checked={selectedDeviceId === String(d.deviceId)}
                        onChange={() => setSelectedDeviceId(String(d.deviceId))}
                        className="text-sky-600"
                      />
                      <div>
                        <div className="text-xs font-semibold text-slate-800">{d.deviceName}</div>
                        <div className="text-[11px] font-mono text-slate-500">{d.deviceIP}:{d.devicePort}</div>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">{d.role}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* Step 2: Select Date Range */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700 font-bold text-xs">
                2
              </span>
              <label className="text-sm font-semibold text-slate-800">Select Date / Range</label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
              {[
                { id: 'today', label: 'Today', hint: 'Punches from today only' },
                { id: 'yesterday', label: 'Yesterday & Today', hint: 'Last 2 days of logs' },
                { id: '7d', label: 'Last 7 Days', hint: 'Default recommended lookback' },
                { id: '30d', label: 'Last 30 Days', hint: 'Past month of punches' },
                { id: 'month', label: 'This Month', hint: '1st of month to today' },
                { id: 'custom', label: 'Custom Range...', hint: 'Specify exact dates' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDatePreset(p.id)}
                  className={`p-3 rounded-lg text-left border transition ${
                    datePreset === p.id
                      ? 'border-sky-500 bg-sky-50/60 ring-1 ring-sky-500'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className={`text-xs font-semibold ${datePreset === p.id ? 'text-sky-900' : 'text-slate-800'}`}>
                    {p.label}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{p.hint}</div>
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div>
                  <label className="text-xs font-medium text-slate-700">From Date *</label>
                  <input
                    type="date"
                    required
                    className="input mt-1 w-full text-xs"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">To Date (Optional)</label>
                  <input
                    type="date"
                    className="input mt-1 w-full text-xs"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* Step 3: Start Sync */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="text-xs text-slate-500">
              {busy ? progressMsg : 'Ready to communicate with terminals and stage punches.'}
            </div>

            <button
              type="submit"
              disabled={busy || devices.length === 0}
              className="btn !px-6 !py-2.5 !text-sm font-semibold shadow-md disabled:opacity-50"
            >
              {busy ? 'Sync In Progress...' : 'Start Sync'}
            </button>
          </div>
        </form>
      </div>

      {/* Live Sync Results Panel */}
      {results.length > 0 && (
        <section className="card p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">Sync Execution Results</h2>
            <div className="flex gap-2 text-xs">
              <Link to="/history" className="text-sky-600 font-semibold hover:text-sky-800">
                View in Sync History →
              </Link>
              <span className="text-slate-300">|</span>
              <Link to="/outbox" className="text-sky-600 font-semibold hover:text-sky-800">
                Check Outbox →
              </Link>
            </div>
          </div>

          <div className="space-y-3">
            {results.map((r, idx) => {
              const isSuccess = r.status === 'Success'
              return (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border text-xs ${
                    isSuccess
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                      : 'bg-rose-50/70 border-rose-200 text-rose-950'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-sm">
                      {isSuccess ? '✓' : '✗'} {r.deviceName || 'Terminal'}
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-bold text-[10px] ${
                        isSuccess ? 'bg-emerald-200 text-emerald-800' : 'bg-rose-200 text-rose-800'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>

                  <p className="mt-1.5 text-slate-700">{r.message}</p>

                  <div className="mt-3 flex flex-wrap gap-4 pt-2 border-t border-slate-200/60 font-medium">
                    <div>
                      Records Read: <span className="font-bold">{r.recordsRead ?? 0}</span>
                    </div>
                    <div>
                      Records Staged in Outbox: <span className="font-bold text-sky-700">{r.recordsQueued ?? 0}</span>
                    </div>
                    {r.startedAt && (
                      <div className="text-slate-500">
                        Started: {dt(r.startedAt)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
