import { useCallback, useEffect, useState } from 'react'
import { agent, errorText, dt } from '../api'

export default function Devices({ status }) {
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(null)
  const [result, setResult] = useState(null)

  // Test Connection state
  const [testingId, setTestingId] = useState(null)
  const [testModalData, setTestModalData] = useState(null)

  // Add / Edit Modal state
  const [deviceModalOpen, setDeviceModalOpen] = useState(false)
  const [editingDevice, setEditingDevice] = useState(null)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [form, setForm] = useState({
    deviceName: '',
    deviceType: 'ZkTeco',
    deviceIP: '',
    devicePort: 4370,
    commPassword: 0,
    serialNumber: '',
    deviceModel: '',
    role: 'Slave',
    isActive: true,
  })

  // Date Range Sync Modal state
  const [syncModalDevice, setSyncModalDevice] = useState(null)
  const [syncDatePreset, setSyncDatePreset] = useState('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // Delete Device Modal state
  const [deleteModalDevice, setDeleteModalDevice] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(() => {
    setError('')
    agent.devices().then((d) => setDevices(d.devices || [])).catch((e) => {
      setError(errorText(e))
      setDevices([])
    })
  }, [])

  async function handleDeleteDevice() {
    if (!deleteModalDevice) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await agent.deleteDevice(deleteModalDevice.deviceId)
      setDeleteModalDevice(null)
      load()
      setResult({
        deviceName: deleteModalDevice.deviceName,
        status: 'Success',
        message: res?.message || 'Device removed / deactivated successfully.'
      })
    } catch (err) {
      setDeleteError(errorText(err))
    } finally {
      setDeleting(false)
    }
  }

  useEffect(load, [load])

  function openAddModal() {
    setEditingDevice(null)
    setForm({
      deviceName: '',
      deviceType: 'ZkTeco',
      deviceIP: '',
      devicePort: 4370,
      commPassword: 0,
      serialNumber: '',
      deviceModel: '',
      role: 'Slave',
      isActive: true,
    })
    setFormError('')
    setDeviceModalOpen(true)
  }

  function openEditModal(device) {
    setEditingDevice(device)
    setForm({
      deviceName: device.deviceName || '',
      deviceType: device.deviceType || 'ZkTeco',
      deviceIP: device.deviceIP || '',
      devicePort: device.devicePort || 4370,
      commPassword: device.commPassword || 0,
      serialNumber: device.serialNumber || '',
      deviceModel: device.deviceModel || '',
      role: device.role || 'Slave',
      isActive: device.isActive ?? true,
    })
    setFormError('')
    setDeviceModalOpen(true)
  }

  async function handleSaveDevice(e) {
    e.preventDefault()
    setFormSaving(true)
    setFormError('')

    try {
      const payload = {
        ...form,
        devicePort: Number(form.devicePort),
        commPassword: Number(form.commPassword),
      }

      if (editingDevice) {
        await agent.updateDevice(editingDevice.deviceId, payload)
      } else {
        await agent.createDevice(payload)
      }

      setDeviceModalOpen(false)
      load()
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setFormSaving(false)
    }
  }

  async function testConnection(device) {
    setTestingId(device.deviceId)
    try {
      const res = await agent.testConnection(device.deviceId)
      setTestModalData({ device, ...res })
    } catch (e) {
      setTestModalData({
        device,
        success: false,
        message: errorText(e),
      })
    } finally {
      setTestingId(null)
    }
  }

  async function startSync(device, fromDate = null, toDate = null) {
    setSyncing(device.deviceId)
    setResult(null)
    try {
      const options = {}
      if (fromDate) options.fromDate = fromDate
      if (toDate) options.toDate = toDate

      const run = await agent.sync(device.deviceId, options)
      setResult(run)
      setSyncModalDevice(null)
      load()
    } catch (e) {
      setResult({ status: 'Failed', deviceName: device.deviceName, message: errorText(e) })
    } finally {
      setSyncing(null)
    }
  }

  function handleCustomSyncSubmit(e) {
    e.preventDefault()
    if (!syncModalDevice) return

    let from = null
    let to = null
    const today = new Date()

    if (syncDatePreset === 'today') {
      from = today.toISOString().slice(0, 10)
    } else if (syncDatePreset === 'yesterday') {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      from = y.toISOString().slice(0, 10)
    } else if (syncDatePreset === '7d') {
      const d7 = new Date(today)
      d7.setDate(d7.getDate() - 7)
      from = d7.toISOString().slice(0, 10)
    } else if (syncDatePreset === '30d') {
      const d30 = new Date(today)
      d30.setDate(d30.getDate() - 30)
      from = d30.toISOString().slice(0, 10)
    } else if (syncDatePreset === 'custom') {
      from = customFrom || null
      to = customTo || null
    }

    startSync(syncModalDevice, from, to)
  }

  if (status && !status.configured) {
    return (
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-900">Not configured</h2>
        <p className="mt-2 text-sm text-slate-600">
          Register this agent in the central app, then paste its key and secret into{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">appsettings.json</code> and restart.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {status && !status.connected && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Cannot reach the central server. You can still test connections and sync devices locally. Punches are saved to disk and will sync once online.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>
      )}

      {result && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ring-1 ${
            result.status === 'Success'
              ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
              : 'bg-rose-50 text-rose-800 ring-rose-200'
          }`}
        >
          <b>{result.deviceName}</b> — {result.message}
        </div>
      )}

      {/* Device List Section */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Registered Devices</h2>
            <p className="text-xs text-slate-400">Terminals assigned to this agent branch</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={load}>
              Refresh
            </button>
            <button
              className="btn-ghost !px-2.5 !py-1 !text-xs text-sky-700 font-semibold"
              onClick={async () => {
                for (const d of (devices || [])) {
                  await startSync(d)
                }
              }}
              disabled={syncing !== null || !devices || devices.length === 0}
            >
              Sync All
            </button>
            <button className="btn !px-3 !py-1 !text-xs font-semibold shadow-sm" onClick={openAddModal}>
              + Add Device
            </button>
          </div>
        </div>

        {!devices ? (
          <p className="py-12 text-center text-sm text-slate-400">Loading devices...</p>
        ) : devices.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <p className="text-sm text-slate-500">No devices assigned to this agent.</p>
            <button className="btn !px-3 !py-1.5 !text-xs" onClick={openAddModal}>
              + Add Your First Device
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Device</th>
                  <th className="px-4 py-2.5 font-medium">Type / Brand</th>
                  <th className="px-4 py-2.5 font-medium">Network Address</th>
                  <th className="px-4 py-2.5 font-medium">Model / Serial</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Comm Key</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.map((d) => {
                  const isSyncing = syncing === d.deviceId
                  const isTesting = testingId === d.deviceId

                  return (
                    <tr key={d.deviceId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {d.deviceName}
                        {d.isOnline && (
                          <span className="ml-2 inline-block h-2 w-2 rounded-full bg-emerald-500" title="Online" />
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            (d.deviceType || 'ZkTeco') === 'Hikvision'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : (d.deviceType || 'ZkTeco') === 'Dahua'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : (d.deviceType || 'ZkTeco') === 'Fake'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-teal-50 text-teal-700 border border-teal-200'
                          }`}
                        >
                          {d.deviceType || 'ZkTeco'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600 font-mono text-xs">
                        {d.deviceIP}:{d.devicePort}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">
                        {d.deviceModel || 'ZKTeco'} {d.serialNumber ? `· S/N: ${d.serialNumber}` : ''}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            d.role === 'Master'
                              ? 'bg-sky-50 text-sky-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {d.role}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs tabular-nums">
                        {d.commPassword === 0 ? 'None (0)' : '******'}
                      </td>
                      <td className="px-4 py-2.5 text-right space-x-1.5">
                        <button
                          className="btn-ghost !px-2.5 !py-1 !text-xs"
                          disabled={isTesting}
                          onClick={() => testConnection(d)}
                        >
                          {isTesting ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          className="btn-ghost !px-2.5 !py-1 !text-xs text-slate-600"
                          onClick={() => openEditModal(d)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-ghost !px-2.5 !py-1 !text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => {
                            setDeleteModalDevice(d)
                            setDeleteError('')
                          }}
                        >
                          Delete
                        </button>
                        <button
                          className="btn !px-3 !py-1 !text-xs font-semibold"
                          disabled={isSyncing}
                          onClick={() => startSync(d)}
                          title="1-click sync new punches"
                        >
                          {isSyncing ? 'Syncing...' : 'Sync'}
                        </button>
                        <button
                          className="btn-ghost !px-2 !py-1 !text-xs text-slate-400 hover:text-slate-600"
                          disabled={isSyncing}
                          onClick={() => setSyncModalDevice(d)}
                          title="Sync custom date range"
                        >
                          Range...
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

      {/* Add / Edit Device Modal */}
      {deviceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {editingDevice ? `Edit Device: ${editingDevice.deviceName}` : 'Add New Device'}
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
                onClick={() => setDeviceModalOpen(false)}
              >
                ×
              </button>
            </div>

            {formError && (
              <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveDevice} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-slate-700">Device Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Main Entrance Reader"
                    className="input mt-1 w-full"
                    value={form.deviceName}
                    onChange={(e) => setForm({ ...form, deviceName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="font-medium text-slate-700">Device Brand / Type *</label>
                  <select
                    className="input mt-1 w-full font-medium"
                    value={form.deviceType}
                    onChange={(e) => {
                      const type = e.target.value
                      const defaultPort =
                        type === 'Hikvision' ? 80 :
                        type === 'Dahua' ? 37777 :
                        type === 'Anviz' ? 5005 :
                        4370
                      setForm({
                        ...form,
                        deviceType: type,
                        devicePort:
                          form.devicePort === 4370 || form.devicePort === 80 || form.devicePort === 37777 || form.devicePort === 5005
                            ? defaultPort
                            : form.devicePort,
                      })
                    }}
                  >
                    <option value="ZkTeco">ZKTeco (TCP 4370)</option>
                    <option value="Hikvision">Hikvision (ISAPI / HTTP)</option>
                    <option value="Dahua">Dahua (TCP / HTTP)</option>
                    <option value="Anviz">Anviz (TCP)</option>
                    <option value="eSSL">eSSL (TCP / API)</option>
                    <option value="HttpPush">HTTP Push / Webhook</option>
                    <option value="Fake">Fake / Simulator (Test)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="font-medium text-slate-700">IP Address *</label>
                  <input
                    type="text"
                    required
                    placeholder="192.168.1.201"
                    className="input mt-1 w-full font-mono"
                    value={form.deviceIP}
                    onChange={(e) => setForm({ ...form, deviceIP: e.target.value })}
                  />
                </div>
                <div>
                  <label className="font-medium text-slate-700">Port</label>
                  <input
                    type="number"
                    required
                    placeholder="4370"
                    className="input mt-1 w-full font-mono"
                    value={form.devicePort}
                    onChange={(e) => setForm({ ...form, devicePort: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-slate-700">Comm Password (Key)</label>
                  <input
                    type="number"
                    placeholder="0"
                    className="input mt-1 w-full"
                    value={form.commPassword}
                    onChange={(e) => setForm({ ...form, commPassword: e.target.value })}
                  />
                  <p className="mt-0.5 text-[10px] text-slate-400">0 if not set on terminal</p>
                </div>
                <div>
                  <label className="font-medium text-slate-700">Role</label>
                  <select
                    className="input mt-1 w-full"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                  >
                    <option value="Slave">Slave (Punches only)</option>
                    <option value="Master">Master (Enrolment source)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-slate-700">Model</label>
                  <input
                    type="text"
                    placeholder="e.g. K40, uFace800"
                    className="input mt-1 w-full"
                    value={form.deviceModel}
                    onChange={(e) => setForm({ ...form, deviceModel: e.target.value })}
                  />
                </div>
                <div>
                  <label className="font-medium text-slate-700">Serial Number</label>
                  <input
                    type="text"
                    placeholder="Optional"
                    className="input mt-1 w-full"
                    value={form.serialNumber}
                    onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="devIsActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <label htmlFor="devIsActive" className="text-slate-700">
                  Active (include in sync runs)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  className="btn-ghost !px-3 !py-1.5"
                  onClick={() => setDeviceModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="btn !px-4 !py-1.5 font-semibold"
                >
                  {formSaving ? 'Saving...' : editingDevice ? 'Save Changes' : 'Add Device'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Test Connection Results Dialog */}
      {testModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Test Connection: {testModalData.device.deviceName}
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
                onClick={() => setTestModalData(null)}
              >
                ×
              </button>
            </div>

            <div
              className={`rounded-lg p-3 text-xs border ${
                testModalData.success
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              <div className="font-semibold text-sm">
                {testModalData.success ? '✓ Connection Successful' : '✗ Connection Failed'}
              </div>
              <div className="mt-1">{testModalData.message}</div>
            </div>

            {testModalData.success && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
                <div className="text-[11px] font-semibold uppercase text-slate-500">Terminal Diagnostics</div>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <div>IP Address: <span className="font-mono font-medium">{testModalData.device.deviceIP}</span></div>
                  <div>Port: <span className="font-mono font-medium">{testModalData.device.devicePort}</span></div>
                  <div>Firmware: <span className="font-medium">{testModalData.firmwareVersion || 'N/A'}</span></div>
                  <div>Serial No: <span className="font-medium">{testModalData.serialNumber || 'N/A'}</span></div>
                  <div>Users on Device: <span className="font-medium">{testModalData.userCount}</span></div>
                  <div>Logs in Memory: <span className="font-medium">{testModalData.logCount}</span></div>
                  {testModalData.deviceTime && (
                    <div className="col-span-2">
                      Device Clock: <span className="font-medium">{dt(testModalData.deviceTime)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button className="btn !px-4 !py-1.5" onClick={() => setTestModalData(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Date Range Sync Modal */}
      {syncModalDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Manual Sync</h3>
                <p className="text-xs text-slate-500">{syncModalDevice.deviceName} ({syncModalDevice.deviceIP})</p>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
                onClick={() => setSyncModalDevice(null)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCustomSyncSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-medium text-slate-700">Select Date Range</label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  {[
                    { id: 'today', label: 'Today Only' },
                    { id: 'yesterday', label: 'Yesterday + Today' },
                    { id: '7d', label: 'Last 7 Days (Default)' },
                    { id: '30d', label: 'Last 30 Days' },
                    { id: 'custom', label: 'Custom Range...' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSyncDatePreset(p.id)}
                      className={`rounded-lg px-2.5 py-1.5 text-left transition border ${
                        syncDatePreset === p.id
                          ? 'bg-sky-50 border-sky-400 font-semibold text-sky-800'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {syncDatePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div>
                    <label className="font-medium text-slate-700">From Date</label>
                    <input
                      type="date"
                      required
                      className="input mt-1 w-full"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700">To Date</label>
                    <input
                      type="date"
                      className="input mt-1 w-full"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                Punches are retrieved over the local LAN and saved to the agent outbox. Duplicates already received by central are safely deduplicated.
              </p>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  className="btn-ghost !px-3 !py-1.5"
                  onClick={() => setSyncModalDevice(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={syncing !== null}
                  className="btn !px-4 !py-1.5 font-semibold"
                >
                  {syncing === syncModalDevice.deviceId ? 'Syncing...' : 'Start Sync'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Device Confirmation Modal */}
      {deleteModalDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-rose-700 flex items-center gap-2">
                <span>Delete Device</span>
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
                onClick={() => setDeleteModalDevice(null)}
              >
                ×
              </button>
            </div>

            {deleteError && (
              <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
                {deleteError}
              </div>
            )}

            <div className="space-y-3 text-xs text-slate-600">
              <p>
                Are you sure you want to delete terminal{' '}
                <strong className="text-slate-900 font-semibold">{deleteModalDevice.deviceName}</strong>{' '}
                (<span className="font-mono text-slate-700">{deleteModalDevice.deviceIP}:{deleteModalDevice.devicePort}</span>)?
              </p>

              <div className="rounded-lg bg-amber-50 p-3 text-amber-900 border border-amber-200 space-y-1">
                <p className="font-semibold text-[11px]">Safe Data Protection:</p>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  If this device has recorded historical attendance logs, it will be automatically <strong>deactivated</strong> instead of deleted from the database. This ensures your employee attendance records and past payroll reports are completely preserved.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                className="btn-ghost !px-3 !py-1.5"
                disabled={deleting}
                onClick={() => setDeleteModalDevice(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50 transition"
                onClick={handleDeleteDevice}
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
