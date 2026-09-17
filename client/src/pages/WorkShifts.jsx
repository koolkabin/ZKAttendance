import { useEffect, useState, useMemo } from 'react'
import { shifts as api, employees as empApi, departments as deptApi } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import {
  PageHeader,
  Card,
  Button,
  Field,
  Input,
  Select,
  Badge,
  ErrorText,
} from '../components/ui'
import { useFeedback } from '../components/feedback'
import {
  HiOutlineClock,
  HiOutlinePlus,
  HiOutlineUsers,
  HiOutlineSun,
  HiOutlineMoon,
  HiOutlinePencilSquare,
  HiOutlineTrash,
  HiOutlineMagnifyingGlass,
  HiOutlineArrowLeft,
  HiOutlineTableCells,
  HiOutlineSquares2X2,
  HiOutlineBuildingOffice2,
  HiOutlineShieldCheck,
} from 'react-icons/hi2'

const emptyShiftForm = {
  shiftName: '',
  startTime: '10:00',
  endTime: '18:00',
  lateMinutes: 15,
  earlyMinutes: 15,
  breakMinutes: 0,
  isBreakPaid: true,
  isOvernight: false,
  minHoursForFullDay: 4,
  description: '',
  isActive: true,
}

/** Calculate duration in hours between HH:mm and HH:mm */
function computeHours(start, end, overnight) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if (Number.isNaN(sh) || Number.isNaN(eh)) return 0
  let diff = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0))
  if (overnight || diff < 0) diff += 1440
  return Math.round((diff / 60) * 10) / 10
}

/** Format HH:mm into 12-hour string (e.g. 10:00 -> 10:00 AM) */
function formatTime12(hhmm) {
  if (!hhmm) return '--:--'
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const ampm = h >= 12 ? 'PM' : 'AM'
  const displayH = h % 12 || 12
  return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`
}

/** "10:00" plus n minutes */
function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm || '0:00').split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return '--:--'
  const total = (h * 60 + m + Number(minutes || 0) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export default function WorkShifts() {
  const fb = useFeedback()
  const [shiftList, setShiftList] = useState([])
  const [allEmployees, setAllEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // View mode: 'list' (portal directory) or 'editor' (dedicated full-page form)
  const [viewMode, setViewMode] = useState('list')
  const [editingShift, setEditingShift] = useState(null)
  const [form, setForm] = useState(emptyShiftForm)
  const [saving, setSaving] = useState(false)

  // Portal layout toggle: 'cards' or 'table'
  const [displayStyle, setDisplayStyle] = useState('cards')
  const [searchQuery, setSearchQuery] = useState('')

  function loadData() {
    setLoading(true)
    setError('')
    Promise.all([
      api.list({ includeInactive: true }).catch(() => []),
      empApi.list().catch(() => []),
      deptApi.list().catch(() => []),
    ])
      .then(([shiftsData, empsData, deptsData]) => {
        setShiftList(shiftsData || [])
        setAllEmployees(empsData || [])
        setDepartments(deptsData || [])
      })
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  function openCreatePage() {
    setEditingShift(null)
    setForm(emptyShiftForm)
    setViewMode('editor')
  }

  function openEditPage(shift) {
    setEditingShift(shift)
    setForm({
      shiftName: shift.shiftName || '',
      startTime: shift.startTime || '10:00',
      endTime: shift.endTime || '18:00',
      lateMinutes: shift.lateMinutes ?? 15,
      earlyMinutes: shift.earlyMinutes ?? 15,
      breakMinutes: shift.breakMinutes ?? 0,
      isBreakPaid: shift.isBreakPaid ?? true,
      isOvernight: shift.isOvernight ?? false,
      minHoursForFullDay: shift.minHoursForFullDay ?? 4,
      description: shift.description || '',
      isActive: shift.isActive ?? true,
    })
    setViewMode('editor')
  }

  async function handleSaveShift(e) {
    e.preventDefault()
    if (!form.shiftName.trim()) {
      fb.error('Shift name is required.')
      return
    }
    setSaving(true)
    try {
      if (editingShift) {
        await api.update(editingShift.shiftId, form)
        fb.success(`Work shift "${form.shiftName}" updated successfully`)
      } else {
        await api.create(form)
        fb.success(`Work shift "${form.shiftName}" created successfully`)
      }
      setViewMode('list')
      loadData()
    } catch (err) {
      fb.error(apiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteShift(shift) {
    const ok = await fb.confirm({
      title: 'Delete Work Shift',
      message:
        shift.employeeCount > 0
          ? `Shift "${shift.shiftName}" has ${shift.employeeCount} assigned employee(s). Deleting it will deactivate the shift.`
          : `Permanently delete "${shift.shiftName}"?`,
      confirmText: shift.employeeCount > 0 ? 'Deactivate' : 'Delete',
      danger: true,
    })
    if (!ok) return

    try {
      await api.remove(shift.shiftId)
      fb.success('Shift deleted / deactivated')
      loadData()
    } catch (err) {
      fb.error(apiErrorMessage(err))
    }
  }



  // Filtered shifts for portal search
  const filteredShifts = useMemo(() => {
    if (!searchQuery.trim()) return shiftList
    const q = searchQuery.toLowerCase()
    return shiftList.filter(
      (s) =>
        s.shiftName?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.startTime?.includes(q) ||
        s.endTime?.includes(q),
    )
  }, [shiftList, searchQuery])

  // Statistics
  const totalShifts = shiftList.length
  const activeShifts = shiftList.filter((s) => s.isActive).length
  const totalAssignedEmps = shiftList.reduce((acc, s) => acc + (s.employeeCount || 0), 0)
  const defaultHoursEmps = Math.max(0, allEmployees.length - totalAssignedEmps)

  // Live calculation for Shift Editor
  const editorCalculatedHours = useMemo(() => {
    return computeHours(form.startTime, form.endTime, form.isOvernight)
  }, [form.startTime, form.endTime, form.isOvernight])

  const editorLateBuffer = useMemo(() => {
    return addMinutes(form.startTime, form.lateMinutes)
  }, [form.startTime, form.lateMinutes])

  const isFormNight = form.isOvernight || form.startTime >= '18:00' || form.endTime <= '07:00'

  // =========================================================================
  // DEDICATED FULL-PAGE SHIFT EDITOR VIEW
  // =========================================================================
  if (viewMode === 'editor') {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Back Navigation Bar */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-sky-700 transition cursor-pointer"
          >
            <HiOutlineArrowLeft className="h-4 w-4" />
            Back to Work Shifts Portal
          </button>
          <Badge tone={editingShift ? 'blue' : 'green'}>
            {editingShift ? 'Editing Shift' : 'New Shift'}
          </Badge>
        </div>

        <PageHeader
          title={editingShift ? `Edit Work Shift: ${editingShift.shiftName}` : 'Create New Work Shift'}
          subtitle="Define working hours, late arrival grace windows, break times, and day/night rules for this shift."
        />

        {/* Live Visual Timeline & Overview Card */}
        <Card className="p-5 border-sky-100 bg-gradient-to-r from-sky-50/60 via-blue-50/30 to-slate-50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-3 rounded-xl shadow-xs text-white ${
                  isFormNight ? 'bg-slate-900' : 'bg-amber-500'
                }`}
              >
                {isFormNight ? (
                  <HiOutlineMoon className="h-6 w-6 text-indigo-300" />
                ) : (
                  <HiOutlineSun className="h-6 w-6 text-amber-100" />
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Live Shift Preview
                </div>
                <div className="text-xl font-bold text-slate-900">
                  {form.shiftName || 'Untitled Work Shift'}
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Scheduled:{' '}
                  <strong>
                    {formatTime12(form.startTime)} – {formatTime12(form.endTime)}
                  </strong>{' '}
                  ({editorCalculatedHours} working hours)
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="rounded-lg bg-white px-3 py-1.5 shadow-2xs border border-slate-200">
                <span className="text-slate-400 block text-[10px]">On-Time Window</span>
                <strong className="text-emerald-700 font-semibold">
                  Until {formatTime12(editorLateBuffer)} ({form.lateMinutes}m grace)
                </strong>
              </div>
              <div className="rounded-lg bg-white px-3 py-1.5 shadow-2xs border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Early Departure</span>
                <strong className="text-slate-700 font-semibold">{form.earlyMinutes}m grace</strong>
              </div>
              <div className="rounded-lg bg-white px-3 py-1.5 shadow-2xs border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Type</span>
                <strong className="text-slate-700 font-semibold">
                  {form.isOvernight ? 'Overnight (Crosses Midnight)' : 'Same-Day Schedule'}
                </strong>
              </div>
            </div>
          </div>
        </Card>

        {/* Dedicated Form */}
        <form onSubmit={handleSaveShift} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Section 1: General Details */}
            <Card className="p-6 space-y-4">
              <div className="border-b border-slate-100 pb-2">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  General Information
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Basic name and description to identify this shift
                </p>
              </div>

              <Field label="Shift Name" required hint="e.g. Morning Shift, General Shift, Night Crew">
                <Input
                  value={form.shiftName}
                  onChange={(e) => setForm({ ...form, shiftName: e.target.value })}
                  placeholder="e.g. Morning Shift"
                  required
                  autoFocus
                />
              </Field>

              <Field label="Description & Notes">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-sky-500 transition placeholder:text-slate-400"
                  placeholder="Optional details regarding who follows this shift..."
                />
              </Field>

              <div className="pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-sm font-medium text-slate-700">
                    Active Shift (available for employee assignment)
                  </span>
                </label>
              </div>
            </Card>

            {/* Section 2: Time Constraints */}
            <Card className="p-6 space-y-4">
              <div className="border-b border-slate-100 pb-2">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  Working Hours & Schedule
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Check-in and check-out schedule for this shift
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Start Time (Check-In)" required>
                  <Input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => {
                      const st = e.target.value
                      const shouldOvernight = form.endTime && form.endTime < st
                      setForm({ ...form, startTime: st, isOvernight: shouldOvernight })
                    }}
                    required
                  />
                </Field>
                <Field label="End Time (Check-Out)" required>
                  <Input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => {
                      const et = e.target.value
                      const shouldOvernight = form.startTime && et < form.startTime
                      setForm({ ...form, endTime: et, isOvernight: shouldOvernight })
                    }}
                    required
                  />
                </Field>
              </div>

              <div className="rounded-lg bg-slate-50 p-3 border border-slate-200/80 space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isOvernight}
                    onChange={(e) => setForm({ ...form, isOvernight: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-xs font-semibold text-slate-800">
                    Overnight Shift (ends the next calendar morning)
                  </span>
                </label>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Enable this if the shift starts in the evening and concludes after midnight (e.g.
                  10:00 PM to 06:00 AM). The system will correlate punches across day boundaries.
                </p>
              </div>
            </Card>

            {/* Section 3: Lateness & Grace Periods */}
            <Card className="p-6 space-y-4">
              <div className="border-b border-slate-100 pb-2">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  Grace Periods & Lateness
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tolerances before flagging late arrivals or early departures
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Late Grace (Minutes)"
                  hint={`Arrivals up to ${form.lateMinutes}m after start are marked on-time`}
                >
                  <Input
                    type="number"
                    min={0}
                    max={240}
                    value={form.lateMinutes}
                    onChange={(e) =>
                      setForm({ ...form, lateMinutes: Math.max(0, parseInt(e.target.value, 10) || 0) })
                    }
                  />
                </Field>

                <Field
                  label="Early Departure Grace (Minutes)"
                  hint="Allow leaving a few minutes prior to shift end"
                >
                  <Input
                    type="number"
                    min={0}
                    max={240}
                    value={form.earlyMinutes}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        earlyMinutes: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                  />
                </Field>
              </div>
            </Card>

            {/* Section 4: Breaks & Full-Day Policy */}
            <Card className="p-6 space-y-4">
              <div className="border-b border-slate-100 pb-2">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  Breaks & Attendance Thresholds
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Break deductions and minimum hours for attendance credit
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Break Duration (Minutes)">
                  <Input
                    type="number"
                    min={0}
                    max={180}
                    value={form.breakMinutes}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        breakMinutes: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                  />
                </Field>

                <Field label="Min Hours for Full-Day Credit">
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    step={0.5}
                    value={form.minHoursForFullDay}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        minHoursForFullDay: Math.max(1, parseFloat(e.target.value) || 4),
                      })
                    }
                  />
                </Field>
              </div>

              {form.breakMinutes > 0 && (
                <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={form.isBreakPaid}
                    onChange={(e) => setForm({ ...form, isBreakPaid: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-xs font-medium text-slate-700">
                    Paid Break (do not deduct from working hours)
                  </span>
                </label>
              )}
            </Card>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setViewMode('list')}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="px-6">
              {saving ? 'Saving Shift…' : editingShift ? 'Update Shift' : 'Create Work Shift'}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  // =========================================================================
  // MAIN WORK SHIFTS PORTAL DIRECTORY VIEW
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Work Shifts"
        actions={
          <Button onClick={openCreatePage} className="gap-2">
            <HiOutlinePlus className="h-4 w-4" />
            Add New Work Shift
          </Button>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

      {/* ── Summary Stat Cards ────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 bg-white border-slate-200">
          <div className="text-xs font-medium text-slate-500">Total Shifts</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{totalShifts}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Defined schedules</div>
        </Card>

        <Card className="p-4 bg-white border-slate-200">
          <div className="text-xs font-medium text-slate-500">Active Shifts</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{activeShifts}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Ready for assignment</div>
        </Card>

        <Card className="p-4 bg-white border-slate-200">
          <div className="text-xs font-medium text-slate-500">Assigned Employees</div>
          <div className="mt-1 text-2xl font-bold text-sky-600">{totalAssignedEmps}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">On specific shifts</div>
        </Card>

        <Card className="p-4 bg-white border-slate-200">
          <div className="text-xs font-medium text-slate-500">Default Hours</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{defaultHoursEmps}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Using standard hours</div>
        </Card>
      </div>



      {/* ── Search and View Controls ──────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search shifts by name or time…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setDisplayStyle('cards')}
              title="Card Grid View"
              className={`p-1.5 rounded transition cursor-pointer ${
                displayStyle === 'cards'
                  ? 'bg-sky-50 text-sky-700 font-semibold'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <HiOutlineSquares2X2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setDisplayStyle('table')}
              title="Table View"
              className={`p-1.5 rounded transition cursor-pointer ${
                displayStyle === 'table'
                  ? 'bg-sky-50 text-sky-700 font-semibold'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <HiOutlineTableCells className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Content View (Cards or Table) ─────────────────────────── */}
      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading work shifts…</div>
      ) : filteredShifts.length === 0 ? (
        <Card className="p-12 text-center">
          <HiOutlineClock className="mx-auto h-12 w-12 text-slate-300" />
          <h3 className="mt-3 text-base font-semibold text-slate-800">
            {searchQuery ? 'No Work Shifts Match Your Search' : 'No Work Shifts Created Yet'}
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
            {searchQuery
              ? 'Try adjusting your search terms or clear the filter.'
              : 'Create work shifts to support different working schedules for your staff.'}
          </p>
          <div className="mt-4">
            <Button onClick={openCreatePage}>
              <HiOutlinePlus className="mr-1.5 h-4 w-4" />
              Add First Work Shift
            </Button>
          </div>
        </Card>
      ) : displayStyle === 'table' ? (
        /* TABLE VIEW (Clean like Departments/Employees) */
        <Card className="overflow-hidden border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5">Shift Name</th>
                  <th className="px-4 py-3.5">Working Hours</th>
                  <th className="px-4 py-3.5">Duration</th>
                  <th className="px-4 py-3.5">Grace Rules</th>
                  <th className="px-4 py-3.5">Breaks</th>
                  <th className="px-4 py-3.5 text-center">Employees</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredShifts.map((s) => {
                  const isNight = s.isOvernight || s.startTime >= '18:00' || s.endTime <= '07:00'
                  return (
                    <tr key={s.shiftId} className="hover:bg-slate-50/60 transition">
                      <td className="px-5 py-3.5 font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          {isNight ? (
                            <HiOutlineMoon className="h-4 w-4 text-indigo-500 shrink-0" />
                          ) : (
                            <HiOutlineSun className="h-4 w-4 text-amber-500 shrink-0" />
                          )}
                          <span>{s.shiftName}</span>
                          {s.isOvernight && (
                            <span className="text-[10px] rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 border border-indigo-200">
                              Overnight
                            </span>
                          )}
                        </div>
                        {s.description && (
                          <div className="text-xs text-slate-400 font-normal truncate max-w-xs mt-0.5">
                            {s.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 tabular-nums text-slate-800 font-medium">
                        {formatTime12(s.startTime)} – {formatTime12(s.endTime)}
                      </td>
                      <td className="px-4 py-3.5 tabular-nums text-slate-600">
                        {s.workHours} hrs
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        Late: <strong>{s.lateMinutes}m</strong> | Early: <strong>{s.earlyMinutes}m</strong>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        {s.breakMinutes > 0 ? `${s.breakMinutes}m (${s.isBreakPaid ? 'Paid' : 'Unpaid'})` : 'None'}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                          <HiOutlineUsers className="h-3.5 w-3.5 text-slate-500" />
                          {s.employeeCount} staff
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge tone={s.isActive ? 'green' : 'slate'}>
                          {s.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEditPage(s)}
                            title="Edit Shift Details"
                            className="rounded p-1.5 text-slate-500 hover:bg-sky-50 hover:text-sky-600 transition cursor-pointer"
                          >
                            <HiOutlinePencilSquare className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteShift(s)}
                            title="Delete or Deactivate"
                            className="rounded p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition cursor-pointer"
                          >
                            <HiOutlineTrash className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* CARD GRID VIEW */
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredShifts.map((s) => {
            const isNight = s.isOvernight || s.startTime >= '18:00' || s.endTime <= '07:00'
            return (
              <Card
                key={s.shiftId}
                className={`overflow-hidden border transition hover:shadow-md ${
                  !s.isActive ? 'opacity-60 bg-slate-50' : 'bg-white'
                }`}
              >
                {/* Card Header Strip */}
                <div
                  className={`flex items-center justify-between border-b px-5 py-3.5 ${
                    isNight
                      ? 'bg-slate-900 text-white'
                      : 'bg-gradient-to-r from-sky-50 to-blue-50 text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {isNight ? (
                      <HiOutlineMoon className="h-5 w-5 text-indigo-400" />
                    ) : (
                      <HiOutlineSun className="h-5 w-5 text-amber-500" />
                    )}
                    <div>
                      <h3 className="font-semibold text-sm leading-tight">{s.shiftName}</h3>
                      <span className="text-[11px] opacity-80">
                        {s.isOvernight ? 'Overnight Shift' : 'Standard Shift'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!s.isActive && <Badge tone="rose">Inactive</Badge>}
                    <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-semibold backdrop-blur-xs">
                      {s.workHours} hrs
                    </span>
                  </div>
                </div>

                {/* Body Details */}
                <div className="p-5 space-y-4">
                  {/* Time Range */}
                  <div className="rounded-lg bg-slate-50 p-3 text-center ring-1 ring-slate-100">
                    <div className="text-xl font-bold tracking-tight text-slate-800">
                      {formatTime12(s.startTime)} – {formatTime12(s.endTime)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      Scheduled working window ({s.startTime} - {s.endTime})
                    </div>
                  </div>

                  {/* Badges / Metrics */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded bg-slate-50/80 p-2 border border-slate-100">
                      <span className="text-slate-400 block text-[10px]">Late Grace</span>
                      <strong className="text-slate-700">{s.lateMinutes} mins</strong>
                    </div>
                    <div className="rounded bg-slate-50/80 p-2 border border-slate-100">
                      <span className="text-slate-400 block text-[10px]">Early Departure</span>
                      <strong className="text-slate-700">{s.earlyMinutes} mins</strong>
                    </div>
                    <div className="rounded bg-slate-50/80 p-2 border border-slate-100">
                      <span className="text-slate-400 block text-[10px]">Break Duration</span>
                      <strong className="text-slate-700">
                        {s.breakMinutes > 0
                          ? `${s.breakMinutes}m (${s.isBreakPaid ? 'Paid' : 'Unpaid'})`
                          : 'None'}
                      </strong>
                    </div>
                    <div className="rounded bg-slate-50/80 p-2 border border-slate-100">
                      <span className="text-slate-400 block text-[10px]">Min Full-Day</span>
                      <strong className="text-slate-700">{s.minHoursForFullDay} hrs</strong>
                    </div>
                  </div>

                  {s.description && (
                    <p className="text-xs text-slate-500 italic line-clamp-2">
                      &ldquo;{s.description}&rdquo;
                    </p>
                  )}

                  {/* Assigned Count & Actions */}
                  <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                    <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                      <HiOutlineUsers className="h-4 w-4 text-slate-400" />
                      <span>{s.employeeCount} staff assigned</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditPage(s)}
                        title="Edit Shift Details"
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                      >
                        <HiOutlinePencilSquare className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteShift(s)}
                        title="Delete / Deactivate"
                        className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                      >
                        <HiOutlineTrash className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

    </div>
  )
}
