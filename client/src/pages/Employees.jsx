import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaEdit } from 'react-icons/fa'
import { RiDeleteBin5Line } from 'react-icons/ri'
import {
  HiChevronUpDown,
  HiOutlineClock,
} from 'react-icons/hi2'
import { MdCalendarMonth } from 'react-icons/md'
import { FiLogIn, FiEye, FiEyeOff, FiAlertTriangle, FiArrowRight } from 'react-icons/fi'
import { employees as api, departments as deptApi, users as usersApi, shifts as shiftApi } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { useAuth } from '../context/AuthContext'
import { useCalendar } from '../context/CalendarContext'
import { PageHeader, Card, Button, Modal, Field, Input, Select, Badge, ErrorText } from '../components/ui'
import { useFeedback } from '../components/feedback'
import DateToggle from '../components/DateToggle'
import NepaliDatePicker from '../components/NepaliDatePicker'
import FormattedDate from '../components/FormattedDate'
import EmployeeCalendarModal from '../components/EmployeeCalendarModal'
import DeviceEnrollPanel from '../components/DeviceEnrollPanel'
import { overview } from '../api/resources'
import { hm, hoursText, isFutureDate, todayIso } from '../lib/dates'
import { MdFingerprint, MdGridView, MdTableRows } from 'react-icons/md'

// ── helpers ───────────────────────────────────────────────────────────────────

const emptyForm = {
  employeeName: '',
  biometricUserId: '',
  departmentId: '',
  defaultShiftId: '',
  phoneNumber: '',
  title: '',
  email: '',
  hireDate: '',
  isActive: true,
  photoUrl: '',
  linkDeviceIds: [],
}

function toPayload(f) {
  return {
    employeeName: f.employeeName.trim(),
    biometricUserId: f.biometricUserId.trim() || null,
    departmentId: f.departmentId ? Number(f.departmentId) : null,
    defaultShiftId: f.defaultShiftId ? Number(f.defaultShiftId) : null,
    phoneNumber: f.phoneNumber.trim() || null,
    title: f.title.trim() || null,
    email: f.email.trim() || null,
    // A hire date in the future is almost always a typo, and it makes every
    // day before it read as "not joined" in the attendance grid.
    hireDate: f.hireDate && !isFutureDate(f.hireDate) ? f.hireDate : null,
    isActive: f.isActive,
    photoUrl: f.photoUrl || null,
    linkDeviceIds: f.linkDeviceIds?.length ? f.linkDeviceIds : null,
  }
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ src, name, size = 8 }) {
  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const sizeClass = size === 20 ? 'h-20 w-20 text-xl' : 'h-9 w-9 text-xs'
  const [imgError, setImgError] = useState(false)

  // Reset error state whenever the photo URL changes so the new image
  // is always attempted after a successful upload + refresh.
  useEffect(() => {
    setImgError(false)
  }, [src])

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setImgError(true)}
        className={`${sizeClass} rounded-full object-cover ring-2 ring-slate-100 shadow-sm flex-shrink-0`}
      />
    )
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-semibold ring-2 ring-slate-100 shadow-sm flex-shrink-0 select-none`}
    >
      {initials}
    </div>
  )
}

// ── PhotoUpload (Instant preview, centered, fail-safe) ───────────────────────
function PhotoUpload({ value, onChange }) {
  const fileRef = useRef(null)
  const [err, setErr] = useState('')

  function onFile(e) {
    setErr('')
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 8 * 1024 * 1024) {
      setErr('Image file should be smaller than 8MB.')
      e.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onerror = () => {
      setErr('Could not read image file.')
    }
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result
      if (!dataUrl) return

      // Set immediately so preview ALWAYS works without delay
      onChange(dataUrl)

      // Optimize to avatar dimensions in background if possible
      try {
        const img = new Image()
        img.onload = () => {
          try {
            const maxDim = 320
            let { width, height } = img
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width)
                width = maxDim
              } else {
                width = Math.round((width * maxDim) / height)
                height = maxDim
              }
              const canvas = document.createElement('canvas')
              canvas.width = width
              canvas.height = height
              const ctx = canvas.getContext('2d')
              ctx.drawImage(img, 0, 0, width, height)
              const format = file.type?.includes('png') ? 'image/png' : 'image/jpeg'
              const opt = canvas.toDataURL(format, 0.85)
              if (opt && opt.length > 50) {
                onChange(opt)
              }
            }
          } catch {
            // Keep original dataUrl
          }
        }
        img.src = dataUrl
      } catch {
        // Keep original dataUrl
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-row items-center gap-4 sm:gap-5 py-1">
      {value ? (
        <div className="relative shrink-0">
          <img
            src={value}
            alt="Profile Preview"
            className="h-16 w-16 sm:h-20 sm:w-20 rounded-full object-cover ring-2 ring-sky-500/30 shadow-md"
          />
        </div>
      ) : (
        <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-slate-100 ring-2 ring-slate-200 flex items-center justify-center text-slate-400 text-3xl sm:text-4xl select-none shrink-0">
          👤
        </div>
      )}

      <div className="flex flex-col items-start gap-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 hover:text-sky-700 hover:ring-sky-400 transition shadow-2xs"
          >
            {value ? 'Change Photo' : 'Choose Photo'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange('')
                setErr('')
              }}
              className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100 transition"
            >
              Remove
            </button>
          )}
        </div>
        {err ? (
          <span className="text-xs font-medium text-rose-600">{err}</span>
        ) : (
          <span className="text-[11px] text-slate-400">JPG, PNG or WEBP up to 8MB</span>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.jpg,.jpeg,.png,.webp,.jfif,.gif,.bmp,.avif"
        className="hidden"
        onChange={onFile}
      />
    </div>
  )
}

// ── PasswordInput ─────────────────────────────────────────────────────────────
function PasswordInput({ value, onChange, placeholder, autoFocus }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required
        minLength={8}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 transition placeholder:text-slate-400"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700 transition-colors"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
      </button>
    </div>
  )
}

// ── EmployeeDetailModal ───────────────────────────────────────────────────────
/**
 * Clicking an employee shows who they are AND how they have been attending.
 * The attendance half is loaded on demand for the last 30 days: first and last
 * scan of the most recent day worked, and the average time spent in the office
 * across the days they actually attended.
 */
function EmployeeDetailModal({ emp, deptName, onClose, onEdit, onCalendar, onEnroll }) {
  const [att, setAtt] = useState(null)
  const [attError, setAttError] = useState('')

  useEffect(() => {
    if (!emp?.employeeId) return
    const to = todayIso()
    const from = new Date(Date.now() - 29 * 864e5)
    const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`

    setAtt(null)
    setAttError('')
    overview
      .get({ from: fromIso, to, employeeId: emp.employeeId })
      .then((res) => {
        const row = res?.departments?.[0]?.employees?.[0]
        if (!row) {
          setAtt({ empty: true })
          return
        }
        // Most recent day with an actual scan.
        const worked = Object.entries(row.cells || {})
          .filter(([, c]) => c?.firstIn)
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        setAtt({
          presentDays: row.presentDays,
          absentDays: row.absentDays,
          totalDays: row.totalDays,
          avgHours: row.avgHours,
          last: worked[0] ? { date: worked[0][0], ...worked[0][1] } : null,
        })
      })
      .catch((e) => setAttError(apiErrorMessage(e)))
  }, [emp?.employeeId])

  if (!emp) return null

  return (
    <Modal title="Employee Details" onClose={onClose} wide>
      <div className="flex flex-col items-center gap-3 pb-4">
        <Avatar src={emp.photoUrl || emp.PhotoUrl} name={emp.employeeName} size={20} />
        <div className="text-center">
          <div className="text-xl font-bold text-slate-900">{emp.employeeName}</div>
          {emp.title && <div className="mt-0.5 text-sm font-medium text-sky-600">{emp.title}</div>}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3.5 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
        <Detail label="Biometric ID" mono value={emp.biometricUserId || '—'} />
        <Detail label="Department" value={deptName(emp.departmentId)} />
        <Detail label="Job Title" value={emp.title || '—'} />
        <Detail
          label="Hire Date"
          value={<FormattedDate date={emp.hireDate} dateBs={emp.hireDateBs} />}
        />
        <Detail
          label="Status"
          value={emp.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}
        />
        <Detail label="Phone" value={emp.phoneNumber || '—'} />
        <div className="col-span-1 sm:col-span-2">
          <Detail label="Email" value={emp.email || '—'} truncate />
        </div>
      </div>

      {/* ── Attendance summary ───────────────────────────────────── */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Attendance · last 30 days
        </h3>

        {attError && <p className="text-sm text-rose-600">{attError}</p>}
        {!att && !attError && <p className="text-sm text-slate-400">Loading…</p>}

        {att && !att.empty && (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Present" value={att.presentDays} tone="emerald" />
              <MiniStat label="Absent" value={att.absentDays} tone="rose" />
              <MiniStat label="Working days" value={att.totalDays} />
              <MiniStat
                label="Avg. hours / day"
                value={att.avgHours > 0 ? hoursText(att.avgHours) : '—'}
                tone="sky"
              />
            </div>

            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Most recent day attended
              </div>
              {att.last ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                  <span className="font-medium text-slate-800">
                    <FormattedDate date={att.last.date} />
                  </span>
                  <span className="text-slate-600">
                    In <b className="tabular-nums text-emerald-700">{hm(att.last.firstIn)}</b>
                  </span>
                  <span className="text-slate-600">
                    Out{' '}
                    <b className="tabular-nums text-sky-700">
                      {att.last.lastOut ? hm(att.last.lastOut) : '—'}
                    </b>
                  </span>
                  {att.last.hours > 0 && (
                    <span className="text-slate-600">
                      Worked <b className="tabular-nums">{hoursText(att.last.hours)}</b>
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-sm text-slate-400">No scan recorded in this period.</div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        {onEnroll && (
          <Button
            variant="secondary"
            onClick={() => {
              onClose()
              onEnroll(emp)
            }}
          >
            <MdFingerprint className="mr-1.5 inline-block h-4 w-4" /> Biometric
          </Button>
        )}
        {onCalendar && (
          <Button
            variant="secondary"
            onClick={() => {
              onClose()
              onCalendar(emp)
            }}
          >
            <MdCalendarMonth className="mr-1.5 inline-block h-4 w-4" /> Calendar
          </Button>
        )}
        <Button
          onClick={() => {
            onClose()
            onEdit(emp)
          }}
        >
          <FaEdit className="mr-1.5 inline-block h-3.5 w-3.5" /> Edit
        </Button>
      </div>
    </Modal>
  )
}

function Detail({ label, value, mono, truncate }) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-slate-400">{label}</div>
      <div
        className={`font-medium text-slate-800 ${mono ? 'font-mono' : ''} ${truncate ? 'truncate' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone = 'slate' }) {
  const toneClass = {
    emerald: 'text-emerald-700',
    rose: 'text-rose-600',
    sky: 'text-sky-700',
    slate: 'text-slate-800',
  }[tone]
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  )
}

// ── EmployeeCardGrid (calendar view) ─────────────────────────────────────────
/**
 * The alternative to the table: one card per person, sized for a tap rather
 * than a dense row, with the calendar as the primary action. Clicking anywhere
 * else on the card opens the same detail panel the table row does.
 */
function EmployeeCardGrid({ rows, loading, deptName, shiftMap, onOpen, onCalendar, onEnroll }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400 shadow-sm">
        Loading employees…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400 shadow-sm">
        No employees found.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((r) => (
        <div
          key={r.employeeId}
          onClick={() => onOpen(r)}
          className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-300 hover:shadow-md"
          title="Click to view details"
        >
          <div className="flex items-start gap-3">
            <Avatar src={r.photoUrl || r.PhotoUrl} name={r.employeeName} size={20} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-slate-900">{r.employeeName}</div>
              <div className="truncate text-xs text-slate-500">{r.title || '—'}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-400">{deptName(r.departmentId)}</span>
                {r.defaultShiftId && shiftMap?.get(r.defaultShiftId) && (
                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200">
                    {shiftMap.get(r.defaultShiftId).shiftName}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
            <div className="min-w-0 text-xs text-slate-500">
              <span className="font-mono">{r.biometricUserId || r.employeeId}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              {r.isActive ? (
                <span className="text-emerald-600">Active</span>
              ) : (
                <span className="text-slate-400">Inactive</span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => onEnroll(r)}
                title="Register on a ZKTeco terminal"
                className="rounded p-1.5 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600"
              >
                <MdFingerprint className="h-4.5 w-4.5" />
              </button>
              <button
                type="button"
                onClick={() => onCalendar(r)}
                title="View attendance calendar"
                className="rounded p-1.5 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600"
              >
                <MdCalendarMonth className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── SortableHeader ────────────────────────────────────────────────────────────
function SortableHeader({ label, sortKey, sortState, onSort }) {
  const active = sortState.key === sortKey
  return (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-slate-600 whitespace-nowrap cursor-pointer select-none hover:text-slate-900 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <HiChevronUpDown
          className={`h-4 w-4 transition-colors ${
            active ? 'text-sky-600 font-bold' : 'text-slate-300'
          }`}
        />
      </span>
    </th>
  )
}

// ── Main Employees Page ───────────────────────────────────────────────────────
export default function Employees() {
  const fb = useFeedback()
  const { isAdmin } = useAuth()
  const { isBs } = useCalendar()

  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [workShifts, setWorkShifts] = useState([])
  const [unregistered, setUnregistered] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const [calendarFor, setCalendarFor] = useState(null)
  const [detail, setDetail] = useState(null)
  const [enrollFor, setEnrollFor] = useState(null)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('zk_employees_view') || 'table')

  function changeView(mode) {
    setViewMode(mode)
    localStorage.setItem('zk_employees_view', mode)
  }

  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  const [search, setSearch] = useState('')

  const deptName = useMemo(() => {
    const map = new Map(departments.map((d) => [d.departmentId, d.departmentName]))
    return (id) => map.get(id) || '—'
  }, [departments])

  const shiftMap = useMemo(() => {
    return new Map(workShifts.map((s) => [s.shiftId, s]))
  }, [workShifts])

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const [emps, depts, unreg, sfts] = await Promise.all([
        api.list(),
        deptApi.list(),
        api.unregistered(),
        shiftApi.list().catch(() => []),
      ])
      setEmployees(emps)
      setDepartments(depts)
      setUnregistered(unreg)
      setWorkShifts(sfts || [])
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate(biometricUserId = '', linkDeviceIds = []) {
    setEditing({})
    setForm({ ...emptyForm, biometricUserId, linkDeviceIds })
    setFormError('')
  }

  function openEdit(emp) {
    setEditing(emp)
    setForm({
      employeeName: emp.employeeName || '',
      biometricUserId: emp.biometricUserId || '',
      departmentId: emp.departmentId ? String(emp.departmentId) : '',
      defaultShiftId: emp.defaultShiftId ? String(emp.defaultShiftId) : '',
      phoneNumber: emp.phoneNumber || '',
      title: emp.title || '',
      email: emp.email || '',
      hireDate: emp.hireDate ? emp.hireDate.slice(0, 10) : '',
      isActive: emp.isActive,
      photoUrl: emp.photoUrl || emp.PhotoUrl || '',
      linkDeviceIds: [],
    })
    setFormError('')
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')

    const name = form.employeeName?.trim()
    if (!name) {
      setFormError('Employee name is required.')
      setSaving(false)
      return
    }

    const deptId = form.departmentId ? Number(form.departmentId) : null
    if (!deptId) {
      setFormError('Department is required. Please select a department.')
      setSaving(false)
      return
    }

    try {
      const payload = toPayload(form)
      const isNew = !editing.employeeId

      if (!isNew) {
        // Editing: send photo via dedicated endpoint so the main update
        // payload stays small, then update employee fields.
        const photoToUpload = payload.photoUrl?.startsWith('data:') ? payload.photoUrl : null
        if (photoToUpload) payload.photoUrl = null
        await api.update(editing.employeeId, payload)
        if (photoToUpload) {
          try {
            await api.updatePhoto(editing.employeeId, photoToUpload)
          } catch {
            fb.error('Employee updated but photo upload failed — try editing again.')
          }
        }
        fb.success('Employee updated')
      } else {
        // Creating: include photo directly in the create payload
        // (backend EmployeeRequest.PhotoUrl supports base-64 data-URLs)
        const created = await api.create(payload)
        const newId = created?.employeeId
        fb.success(isAdmin ? 'Employee added' : 'Sent to an admin for approval')

        // If photo was included in create payload but still needs uploading
        // (e.g. create succeeded but photo wasn't persisted), try dedicated endpoint.
        if (payload.photoUrl?.startsWith('data:') && newId) {
          try {
            await api.updatePhoto(newId, payload.photoUrl)
          } catch {
            // Non-fatal: the photo in the create payload should have worked
          }
        }

        // The database row is only half of adding somebody. Until they exist
        // on the terminal, their first scan is an unattributed punch — so go
        // straight to registering them on the device.
        if (newId && isAdmin) {
          setEnrollFor({ employeeId: newId, employeeName: payload.employeeName, fresh: true })
        }
      }

      setEditing(null)
      refresh()
    } catch (err) {
      setFormError(apiErrorMessage(err, 'Could not save the employee'))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(emp) {
    const ok = await fb.confirm({
      title: 'Delete employee',
      message: `Permanently delete ${emp.employeeName}? Only works if they have no attendance records.`,
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.remove(emp.employeeId)
      fb.success('Deleted')
      refresh()
    } catch (err) {
      fb.error(apiErrorMessage(err))
    }
  }

  // Modal login state
  const [loginFor, setLoginFor] = useState(null)
  const [loginForm, setLoginForm] = useState({ username: '', password: '', role: 'Employee' })
  const [loginError, setLoginError] = useState('')
  const [loginSaving, setLoginSaving] = useState(false)

  function openLoginModal(emp) {
    const username = (emp.email || emp.employeeName || '')
      .split('@')[0]
      .toLowerCase()
      .replace(/\s+/g, '')
    setLoginFor(emp)
    setLoginForm({ username, password: '', role: 'Employee' })
    setLoginError('')
  }

  async function saveLogin(e) {
    e.preventDefault()
    setLoginSaving(true)
    setLoginError('')
    try {
      const res = await api.createLogin(loginFor.employeeId, {
        username: loginForm.username.trim(),
        password: loginForm.password,
        role: loginForm.role,
      })
      fb.success(
        res.adopted
          ? `Linked existing account "${res.username}" to ${loginFor.employeeName}`
          : `Login created for ${loginFor.employeeName}`,
      )
      setLoginFor(null)
      refresh()
    } catch (err) {
      setLoginError(apiErrorMessage(err, 'Could not create login'))
    } finally {
      setLoginSaving(false)
    }
  }

  async function toggleLoginActive(r) {
    try {
      await usersApi.setActive(r.login.userId, !r.login.active)
      fb.success(r.login.active ? 'Portal access suspended' : 'Portal access enabled')
      refresh()
    } catch (err) {
      fb.error(apiErrorMessage(err))
    }
  }

  async function changeLoginRole(r, role) {
    try {
      await usersApi.setRole(r.login.userId, role)
      fb.success(`Role updated to ${role}`)
      refresh()
    } catch (err) {
      fb.error(apiErrorMessage(err))
    }
  }

  function toggleSort(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    )
  }

  const rows = useMemo(() => {
    let list = [...employees]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (e) =>
          e.employeeName.toLowerCase().includes(q) ||
          (e.title || '').toLowerCase().includes(q) ||
          (e.biometricUserId || '').includes(q),
      )
    }
    list.sort((a, b) => {
      let av = '',
        bv = ''
      if (sort.key === 'name') {
        av = a.employeeName
        bv = b.employeeName
      } else if (sort.key === 'title') {
        av = a.title || ''
        bv = b.title || ''
      } else if (sort.key === 'hireDate') {
        av = a.hireDate || ''
        bv = b.hireDate || ''
      } else if (sort.key === 'dept') {
        av = deptName(a.departmentId)
        bv = deptName(b.departmentId)
      }
      const cmp = av.localeCompare(bv)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [employees, search, sort, deptName])

  const statusBadge = (emp) => {
    if (emp.approvalStatus === 'Pending') return <Badge tone="amber">Pending</Badge>
    if (emp.approvalStatus === 'Rejected') return <Badge tone="red">Rejected</Badge>
    return (
      <Badge tone={emp.isActive ? 'green' : 'slate'}>{emp.isActive ? 'Active' : 'Inactive'}</Badge>
    )
  }



  return (
    <div>
      <PageHeader
        title="Employees"
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-semibold ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => changeView('table')}
                title="Table view"
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1 transition ${
                  viewMode === 'table' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MdTableRows className="h-3.5 w-3.5" /> Table
              </button>
              <button
                type="button"
                onClick={() => changeView('calendar')}
                title="Calendar view"
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1 transition ${
                  viewMode === 'calendar' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MdGridView className="h-3.5 w-3.5" /> Calendar
              </button>
            </div>
            <DateToggle />
            <input
              type="search"
              placeholder="Search employees…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-sky-500 w-36 sm:w-48"
            />
            <Button onClick={() => openCreate()}>+ New employee</Button>
          </div>
        }
      />

      {!isAdmin && (
        <Card className="mb-4 p-3 text-sm text-amber-800 ring-amber-200">
          Employees you add are sent to an admin for approval before they become active.
        </Card>
      )}

      {unregistered.length > 0 && (
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-xs sm:text-sm text-amber-900 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <FiAlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              <strong>{unregistered.length}</strong> biometric ID{unregistered.length > 1 ? 's have' : ' has'} punched from a device but {unregistered.length > 1 ? 'are' : 'is'} not added to any employee.
            </span>
          </div>
          <Link
            to="/unregistered"
            className="inline-flex items-center gap-1 shrink-0 font-semibold text-amber-800 hover:text-amber-950 underline underline-offset-2 hover:no-underline transition"
          >
            <span>View Unregistered IDs</span>
            <FiArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {/* ── Employee Table with Sorting & Click Details ── */}
      {viewMode === 'table' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">Employee ID</th>
                <SortableHeader label="Employee" sortKey="name" sortState={sort} onSort={toggleSort} />
                <SortableHeader label="Job Title" sortKey="title" sortState={sort} onSort={toggleSort} />
                <SortableHeader label="Hire Date" sortKey="hireDate" sortState={sort} onSort={toggleSort} />
                <SortableHeader label="Department" sortKey="dept" sortState={sort} onSort={toggleSort} />
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">Shift</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Login</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    Loading employees…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    No employees found.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.employeeId}
                  className="hover:bg-sky-50/40 cursor-pointer transition-colors"
                  title="Click to view details"
                  onClick={() => setDetail(r)}
                >
                  {/* Employee ID */}
                  <td className="px-4 py-3 text-xs font-mono text-slate-600 whitespace-nowrap">
                    {r.biometricUserId || r.employeeId}
                  </td>

                  {/* Name + Rounded Avatar */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar src={r.photoUrl || r.PhotoUrl} name={r.employeeName} size={9} />
                      <div>
                        <div className="font-semibold text-slate-900 whitespace-nowrap">
                          {r.employeeName}
                        </div>
                        {r.email && (
                          <div className="text-xs text-slate-500">
                            {r.email}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Job Title */}
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {r.title || <span className="text-slate-300">—</span>}
                  </td>

                  {/* Hire Date */}
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    <FormattedDate date={r.hireDate} dateBs={r.hireDateBs} />
                  </td>

                  {/* Department */}
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {deptName(r.departmentId)}
                  </td>

                  {/* Work Shift */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.defaultShiftId && shiftMap.get(r.defaultShiftId) ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200/70">
                        <HiOutlineClock className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                        <span>{shiftMap.get(r.defaultShiftId).shiftName}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Default Hours</span>
                    )}
                  </td>

                  {/* Employee Status */}
                  <td className="px-4 py-3 whitespace-nowrap">{statusBadge(r)}</td>

                  {/* Login Column */}
                  <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {r.login ? (
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            r.login.active
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                              : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              r.login.active ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          {r.login.active ? 'Active' : 'Suspended'}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleLoginActive(r)}
                          className={`text-[11px] font-medium hover:underline ${
                            r.login.active ? 'text-amber-600' : 'text-emerald-600'
                          }`}
                        >
                          {r.login.active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    ) : r.approvalStatus === 'Pending' || r.approvalStatus === 'Rejected' ? (
                      <span className="text-slate-300 text-xs">—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openLoginModal(r)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 transition shadow-sm"
                      >
                        <FiLogIn className="h-3.5 w-3.5" />
                        Login
                      </button>
                    )}
                  </td>

                  {/* Action Icons */}
                  <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {/* View Calendar */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCalendarFor(r)
                        }}
                        title="View attendance calendar"
                        className="rounded p-1.5 text-slate-500 hover:bg-sky-50 hover:text-sky-600 transition-colors"
                      >
                        <MdCalendarMonth className="h-4.5 w-4.5" />
                      </button>

                      {/* Biometric enrolment */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEnrollFor({ employeeId: r.employeeId, employeeName: r.employeeName })
                        }}
                        title="Register on a ZKTeco terminal"
                        className="rounded p-1.5 text-slate-500 transition-colors hover:bg-sky-50 hover:text-sky-600"
                      >
                        <MdFingerprint className="h-4.5 w-4.5" />
                      </button>

                      {/* Edit */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(r)
                        }}
                        title="Edit employee"
                        className="rounded p-1.5 text-slate-500 hover:bg-sky-50 hover:text-sky-600 transition-colors"
                      >
                        <FaEdit className="h-4 w-4" />
                      </button>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(r)
                        }}
                        title="Delete employee"
                        className="rounded p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                      >
                        <RiDeleteBin5Line className="h-4.5 w-4.5 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmployeeCardGrid
          rows={rows}
          loading={loading}
          deptName={deptName}
          shiftMap={shiftMap}
          onOpen={setDetail}
          onCalendar={setCalendarFor}
          onEnroll={(e) => setEnrollFor({ employeeId: e.employeeId, employeeName: e.employeeName })}
        />
      )}



      {/* ── Create / Edit Modal ── */}
      {editing && (
        <Modal
          title={editing.employeeId ? 'Edit Employee' : 'New Employee'}
          onClose={() => setEditing(null)}
          wide
        >
          <form onSubmit={save} className="space-y-4">
            <ErrorText>{formError}</ErrorText>

            {/* Photo Upload without webcam */}
            <div className="pb-3 border-b border-slate-100">
              <PhotoUpload
                value={form.photoUrl}
                onChange={(photoUrl) => setForm({ ...form, photoUrl })}
              />
            </div>

            {form.linkDeviceIds?.length > 0 && (
              <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-sky-200">
                Completing biometric ID <b>{form.biometricUserId}</b> — linked to{' '}
                {form.linkDeviceIds.length} device{form.linkDeviceIds.length > 1 ? 's' : ''}.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
              <div className="col-span-1 sm:col-span-2">
                <Field label="Name" required>
                  <Input
                    value={form.employeeName}
                    onChange={(e) => setForm({ ...form, employeeName: e.target.value })}
                    required
                    autoFocus
                  />
                </Field>
              </div>

              <Field label="Biometric ID" hint="Leave blank to auto-assign.">
                <Input
                  value={form.biometricUserId}
                  onChange={(e) => setForm({ ...form, biometricUserId: e.target.value })}
                  readOnly={form.linkDeviceIds?.length > 0}
                />
              </Field>

              <Field label="Department" required>
                <Select
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  required
                >
                  <option value="">Select a department…</option>
                  {departments.map((d) => (
                    <option key={d.departmentId} value={d.departmentId}>
                      {d.departmentName}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Work Shift">
                <Select
                  value={form.defaultShiftId}
                  onChange={(e) => setForm({ ...form, defaultShiftId: e.target.value })}
                >
                  <option value="">Default Company Hours</option>
                  {workShifts
                    .filter((s) => s.isActive || String(s.shiftId) === String(form.defaultShiftId))
                    .map((s) => (
                      <option key={s.shiftId} value={s.shiftId}>
                        {s.shiftName} ({s.startTime} - {s.endTime})
                      </option>
                    ))}
                </Select>
              </Field>

              <Field label="Job Title">
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Software Engineer"
                />
              </Field>

              <Field label="Phone">
                <Input
                  value={form.phoneNumber}
                  onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                />
              </Field>

              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>

              <Field label={`Hire Date (${isBs ? 'BS' : 'AD'})`}>
                <NepaliDatePicker
                  value={form.hireDate}
                  onChange={(val) => setForm({ ...form, hireDate: val })}
                />
              </Field>
            </div>

            {editing.employeeId && (
              <div className="rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-200">
                <DeviceEnrollPanel
                  employeeId={editing.employeeId}
                  employeeName={form.employeeName || editing.employeeName}
                  compact
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-700 pt-1">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active Employee
            </label>

            <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur-xs flex items-center justify-end gap-2 border-t border-slate-100 z-10">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Grant Login Modal ── */}
      {loginFor && (
        <Modal title={`Grant Login — ${loginFor.employeeName}`} onClose={() => setLoginFor(null)}>
          <form onSubmit={saveLogin} className="space-y-5">
            <p className="text-sm text-slate-500">
              Creates login credentials so <span className="font-medium text-slate-700">{loginFor.employeeName}</span> can sign in to the self-service portal.
            </p>

            {loginError && (
              <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">
                {loginError}
              </div>
            )}

            {/* Locked Username */}
            <Field label="Username" hint="Auto-derived from employee email / name">
              <div className="relative">
                <Input
                  value={loginForm.username}
                  readOnly
                  className="bg-slate-50 font-mono text-sm text-slate-600 cursor-not-allowed pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium select-none">
                  🔒 Locked
                </span>
              </div>
            </Field>

            {/* Password with show/hide toggle */}
            <Field label="Password" required hint="Minimum 8 characters">
              <PasswordInput
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                placeholder="Enter a strong password…"
                autoFocus
              />
            </Field>

            {/* Role */}
            <Field label="Access Level" hint="Employee – personal records only · HR / Admin – full management access">
              <Select
                value={loginForm.role}
                onChange={(e) => setLoginForm({ ...loginForm, role: e.target.value })}
              >
                <option value="Employee">Employee (Self-Service only)</option>
                <option value="HR">HR Manager</option>
                <option value="Admin">System Administrator</option>
              </Select>
            </Field>

            <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur-xs flex items-center justify-end gap-2 border-t border-slate-100 z-10">
              <Button type="button" variant="ghost" onClick={() => setLoginFor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loginSaving}>
                {loginSaving ? 'Creating…' : 'Create Login'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Details Modal (triggered by clicking row) ── */}
      {detail && (
        <EmployeeDetailModal
          emp={detail}
          deptName={deptName}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onCalendar={(emp) => setCalendarFor(emp)}
          onEnroll={(emp) => setEnrollFor({ employeeId: emp.employeeId, employeeName: emp.employeeName })}
          onToggleLogin={toggleLoginActive}
          onChangeRole={changeLoginRole}
        />
      )}

      {/* ── Calendar Modal ── */}
      {calendarFor && (
        <EmployeeCalendarModal
          employeeId={calendarFor.employeeId}
          employeeName={calendarFor.employeeName}
          onClose={() => setCalendarFor(null)}
        />
      )}

      {/* ── Biometric Enrolment Modal ── */}
      {enrollFor && (
        <Modal
          title={
            enrollFor.fresh
              ? `${enrollFor.employeeName} added — register them on the terminal`
              : `Biometric enrolment — ${enrollFor.employeeName}`
          }
          onClose={() => setEnrollFor(null)}
          wide
        >
          {enrollFor.fresh && (
            <p className="mb-4 rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-900 ring-1 ring-sky-200">
              Press <b>Register on ZKTeco</b> to open the registration screen on the terminal.
            </p>
          )}
          <DeviceEnrollPanel
            employeeId={enrollFor.employeeId}
            employeeName={enrollFor.employeeName}
          />
          <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
            <Button variant="ghost" onClick={() => setEnrollFor(null)}>
              {enrollFor.fresh ? 'Do this later' : 'Close'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
