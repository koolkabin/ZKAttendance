import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  FaArrowLeft,
  FaCalendarAlt,
  FaPhone,
  FaEnvelope,
  FaBriefcase,
  FaBuilding,
  FaUser,
  FaChevronLeft,
  FaChevronRight,
  FaCalendarDay,
  FaFileExcel,
} from 'react-icons/fa'
import { MdCalendarMonth } from 'react-icons/md'
import { RiFileList3Line } from 'react-icons/ri'
import { employees as empApi, overview, attendance, departments as deptApi } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { ymd, hm, dmy, bsDmy } from '../lib/dates'
import StatusMark from '../components/attendance/StatusMark'
import { Card, Badge, ErrorText } from '../components/ui'
import DayDetailModal from '../components/DayDetailModal'
import { useCalendar } from '../context/CalendarContext'
import DateToggle from '../components/DateToggle'
import { adToBs, MONTH_NAMES_EN, getDaysInBsMonth } from '../lib/nepaliCalendar'
import { bsToAdIso } from '../components/NepaliDatePicker'

const AD_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pad = (n) => String(n).padStart(2, '0')
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function EmployeeReport() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { isBs, setMode } = useCalendar()

  const today = useMemo(() => new Date(), [])
  const todayIso = useMemo(() => ymd(today), [today])
  const todayBs = useMemo(() => adToBs(today), [today])

  // Sync calendar mode with URL if passed on initial visit
  useEffect(() => {
    const qCal = searchParams.get('cal')
    if (qCal === 'ad' && isBs) setMode('AD')
    if (qCal === 'bs' && !isBs) setMode('BS')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Year & month states
  const [selectedYear, setSelectedYear] = useState(() => {
    const qY = searchParams.get('year')
    if (qY) return Number(qY)
    return isBs ? todayBs?.year || 2082 : today.getFullYear()
  })

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const qM = searchParams.get('month')
    if (qM) return Number(qM)
    return isBs ? todayBs?.month || 5 : today.getMonth() + 1
  })

  // Sync year & month when switching calendar mode (AD <-> BS)
  useEffect(() => {
    if (isBs) {
      const bs = adToBs(today)
      setSelectedYear(bs?.year || 2082)
      setSelectedMonth(bs?.month || 5)
    } else {
      setSelectedYear(today.getFullYear())
      setSelectedMonth(today.getMonth() + 1)
    }
  }, [isBs, today])

  // Data states
  const [employee, setEmployee] = useState(null)
  const [deptList, setDeptList] = useState([])
  const [reportData, setReportData] = useState(null)
  const [todayLog, setTodayLog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailModal, setDetailModal] = useState(null)
  const [tableFilter, setTableFilter] = useState('all') // 'all' | 'present' | 'absent' | 'holiday'

  // Load departments once for name resolution
  useEffect(() => {
    deptApi.list()
      .then((data) => setDeptList(data || []))
      .catch(() => {})
  }, [])

  // Load employee profile
  useEffect(() => {
    if (!id) return
    empApi.get(id)
      .then(setEmployee)
      .catch((e) => setError(apiErrorMessage(e)))
  }, [id])

  // Compute active date range for the month
  const range = useMemo(() => {
    const year = Number(selectedYear)
    const month = Number(selectedMonth)

    if (isBs) {
      const days = getDaysInBsMonth(year, month)
      const fromIso = bsToAdIso(year, month, 1)
      const toIso = bsToAdIso(year, month, days)
      return {
        from: fromIso,
        to: toIso,
        daysCount: days,
        label: `${MONTH_NAMES_EN[month - 1] || 'Month'} ${year} BS`,
      }
    }

    const daysInMonth = new Date(year, month, 0).getDate()
    const fromIso = `${year}-${pad(month)}-01`
    const toIso = `${year}-${pad(month)}-${pad(daysInMonth)}`
    return {
      from: fromIso,
      to: toIso,
      daysCount: daysInMonth,
      label: `${AD_MONTHS[month - 1] || ''} ${year} AD`,
    }
  }, [selectedYear, selectedMonth, isBs])

  // Fetch monthly attendance data for this employee
  useEffect(() => {
    if (!id || !range.from || !range.to) return
    setLoading(true)
    setError('')

    overview.get({
      from: range.from,
      to: range.to,
      employeeId: id,
    })
      .then(setReportData)
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [id, range.from, range.to])

  // Fetch today's punches & status
  useEffect(() => {
    if (!id) return
    attendance.day(id, todayIso)
      .then(setTodayLog)
      .catch(() => {})
  }, [id, todayIso])

  const currentYear = useMemo(() => {
    return isBs ? Number(todayBs?.year) || 2082 : today.getFullYear()
  }, [isBs, today, todayBs])

  const currentMonth = useMemo(() => {
    return isBs ? Number(todayBs?.month) || 5 : today.getMonth() + 1
  }, [isBs, today, todayBs])

  const isAtLatest = Number(selectedYear) >= currentYear && Number(selectedMonth) >= currentMonth

  // Month navigation
  function prevMonth() {
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1)
      setSelectedMonth(12)
    } else {
      setSelectedMonth((m) => m - 1)
    }
  }

  function nextMonth() {
    if (isAtLatest) return
    if (selectedMonth === 12) {
      if (Number(selectedYear) >= currentYear) return
      setSelectedYear((y) => y + 1)
      setSelectedMonth(1)
    } else {
      setSelectedMonth((m) => m + 1)
    }
  }

  function jumpToCurrentMonth() {
    setSelectedYear(currentYear)
    setSelectedMonth(currentMonth)
  }

  // Year options (current - 3 to current, future years restricted)
  const yearOptions = useMemo(() => {
    return [currentYear, currentYear - 1, currentYear - 2, currentYear - 3]
  }, [currentYear])

  // Month options (capped at current month if current year is selected)
  const monthOptions = useMemo(() => {
    const names = isBs ? MONTH_NAMES_EN : AD_MONTHS
    const maxMonth = Number(selectedYear) === currentYear ? currentMonth : 12
    return names
      .map((name, i) => ({ value: i + 1, name }))
      .filter((m) => m.value <= maxMonth)
  }, [isBs, selectedYear, currentYear, currentMonth])

  // Clamp selected year and month if they exceed current year/month
  useEffect(() => {
    if (Number(selectedYear) > currentYear) {
      setSelectedYear(currentYear)
    } else if (Number(selectedYear) === currentYear && Number(selectedMonth) > currentMonth) {
      setSelectedMonth(currentMonth)
    }
  }, [selectedYear, selectedMonth, currentYear, currentMonth])

  // Flattened employee attendance row
  const empOverview = useMemo(() => {
    if (!reportData?.departments) return null
    for (const d of reportData.departments) {
      const found = d.employees?.find((e) => String(e.employeeId) === String(id))
      if (found) return { ...found, departmentName: d.departmentName }
    }
    return null
  }, [reportData, id])

  const cellByIso = empOverview?.cells || {}

  // Day meta dictionary (dateIso -> DayCell)
  const dayMeta = useMemo(() => {
    const map = {}
    for (const d of reportData?.days || []) {
      map[d.dateIso] = d
    }
    return map
  }, [reportData])

  // Build Calendar Grid Days — only BS if in BS mode, only AD if in AD mode
  const calendarCells = useMemo(() => {
    const cells = []
    const y = Number(selectedYear)
    const m = Number(selectedMonth)

    let firstDayOfWeek = 0
    let totalDays = 0

    if (isBs) {
      totalDays = getDaysInBsMonth(y, m)
      const firstAdIso = bsToAdIso(y, m, 1)
      const firstDate = new Date(firstAdIso + 'T00:00:00')
      firstDayOfWeek = firstDate.getDay()

      // Empty slots before 1st of month
      for (let i = 0; i < firstDayOfWeek; i++) {
        cells.push({ empty: true, key: `empty-pre-${i}` })
      }

      for (let d = 1; d <= totalDays; d++) {
        const adIso = bsToAdIso(y, m, d)
        const cell = cellByIso[adIso]
        const meta = dayMeta[adIso]
        const isToday = adIso === todayIso

        cells.push({
          empty: false,
          key: `bs-${d}`,
          dayNum: d,
          dateIso: adIso,
          dateBs: `${y}-${pad(m)}-${pad(d)}`,
          cell,
          meta,
          isToday,
        })
      }
    } else {
      totalDays = new Date(y, m, 0).getDate()
      firstDayOfWeek = new Date(y, m - 1, 1).getDay()

      // Empty slots before 1st of month
      for (let i = 0; i < firstDayOfWeek; i++) {
        cells.push({ empty: true, key: `empty-pre-${i}` })
      }

      for (let d = 1; d <= totalDays; d++) {
        const adIso = `${y}-${pad(m)}-${pad(d)}`
        const cell = cellByIso[adIso]
        const meta = dayMeta[adIso]
        const isToday = adIso === todayIso

        cells.push({
          empty: false,
          key: `ad-${d}`,
          dayNum: d,
          dateIso: adIso,
          cell,
          meta,
          isToday,
        })
      }
    }

    return cells
  }, [selectedYear, selectedMonth, isBs, cellByIso, dayMeta, todayIso])

  // Compute monthly stats
  const stats = useMemo(() => {
    let workingDays = 0
    let presentDays = 0
    let absentDays = 0
    let halfDays = 0
    let holidays = 0
    let totalHours = 0

    for (const c of calendarCells) {
      if (c.empty) continue
      const isOff = c.meta?.isHoliday
      if (isOff) {
        holidays++
      } else {
        const status = c.cell?.status

        // Days that have not happened are not working days yet, so they must
        // not inflate the denominator either.
        if (status === 'Upcoming' || (!c.cell && c.dateIso > todayIso)) continue
        workingDays++
        const hrs = c.cell?.hours || 0
        totalHours += hrs

        if (status === 'Present') {
          if (hrs > 0 && hrs < 4) {
            halfDays++
          } else {
            presentDays++
          }
        } else if (status === 'Absent') {
          absentDays++
        }
      }
    }

    return {
      workingDays: empOverview?.totalDays ?? workingDays,
      presentDays: empOverview?.presentDays ?? presentDays,
      absentDays: empOverview?.absentDays ?? absentDays,
      halfDays,
      holidays,
      totalHours: Number(totalHours.toFixed(2)),
    }
  }, [calendarCells, empOverview, todayIso])

  // Table rows for day-by-day log
  const tableRows = useMemo(() => {
    return calendarCells
      .filter((c) => !c.empty)
      .map((c) => {
        const cell = c.cell
        const meta = c.meta
        const isWeeklyOff = meta?.isHoliday && (meta?.holidayName === 'Weekly off' || meta?.holidayName?.toLowerCase().includes('off'))
        const isHoliday = meta?.isHoliday && !isWeeklyOff

        // A day only becomes Absent once it has actually finished. The server
        // sends 'Upcoming' for today-before-close and for future days; the old
        // default of 'Absent' meant anything it did not recognise, including
        // the rest of the month, was painted red.
        let resolvedStatus = 'Upcoming'
        if (isWeeklyOff || cell?.status === 'Day Off' || cell?.status === 'Weekly off') {
          resolvedStatus = 'Day Off'
        } else if (isHoliday || cell?.status === 'Holiday') {
          resolvedStatus = 'Holiday'
        } else if (cell?.status === 'Not Joined') {
          resolvedStatus = 'Not Joined'
        } else if (cell?.status === 'Half Day' || (cell?.hours > 0 && cell?.hours < 4)) {
          resolvedStatus = 'Half Day'
        } else if (cell?.status === 'Present') {
          resolvedStatus = 'Present'
        } else if (cell?.status === 'Absent') {
          resolvedStatus = 'Absent'
        } else if (!cell && c.dateIso < todayIso) {
          // No cell at all on a past working day still means absent.
          resolvedStatus = 'Absent'
        }

        const weekday = new Date(c.dateIso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })

        return {
          ...c,
          weekday,
          resolvedStatus,
          firstIn: cell?.firstIn ? hm(cell.firstIn) : '—',
          lastOut: cell?.lastOut ? hm(cell.lastOut) : '—',
          hours: cell?.hours || 0,
          punchCount: cell?.punchCount || 0,
          holidayName: meta?.holidayName,
        }
      })
      .filter((r) => {
        if (tableFilter === 'present') return r.resolvedStatus === 'Present' || r.resolvedStatus === 'Half Day'
        if (tableFilter === 'absent') return r.resolvedStatus === 'Absent'
        if (tableFilter === 'holiday') return r.resolvedStatus === 'Holiday' || r.resolvedStatus === 'Day Off'
        return true
      })
  }, [calendarCells, tableFilter, todayIso])

  // Resolve department name
  const departmentName = useMemo(() => {
    if (empOverview?.departmentName) return empOverview.departmentName
    const d = deptList.find((x) => x.departmentId === employee?.departmentId)
    return d?.departmentName || 'General'
  }, [empOverview, deptList, employee])

  // Today's status computation
  const todayStatusInfo = useMemo(() => {
    const count = todayLog?.count ?? 0
    const firstIn = todayLog?.firstIn ? hm(todayLog.firstIn) : null
    const lastOut = todayLog?.lastOut ? hm(todayLog.lastOut) : null

    const todayMeta = dayMeta[todayIso]
    const isHoliday = todayMeta?.isHoliday

    if (count > 0) {
      return {
        label: lastOut ? 'Completed' : 'Checked In',
        badgeColor: 'bg-emerald-500 text-white',
        tone: 'green',
        firstIn,
        lastOut,
        count,
      }
    }
    if (isHoliday) {
      return {
        label: todayMeta?.holidayName || 'Holiday / Day Off',
        badgeColor: 'bg-sky-500 text-white',
        tone: 'sky',
        firstIn: '—',
        lastOut: '—',
        count: 0,
      }
    }
    return {
      label: 'Not Checked In',
      badgeColor: 'bg-rose-500 text-white',
      tone: 'red',
      firstIn: '—',
      lastOut: '—',
      count: 0,
    }
  }, [todayLog, dayMeta, todayIso])

  // Export Table Only to XLSX
  function exportTableXlsx() {
    if (!tableRows || tableRows.length === 0) return
    const head = [
      isBs ? 'Date (BS)' : 'Date (AD)',
      'Day',
      'Status',
      'Check In',
      'Check Out',
      'Hours',
      'Punches Count',
      'Remarks',
    ]
    const data = tableRows.map((r) => [
      isBs ? bsDmy(r.dateBs) || dmy(r.dateIso) : dmy(r.dateIso),
      r.weekday || '',
      r.resolvedStatus || '',
      r.firstIn || '',
      r.lastOut || '',
      r.hours ? Number(r.hours.toFixed(2)) : 0,
      r.punchCount || 0,
      r.holidayName || '',
    ])
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([head, ...data])
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    const empName = (employee?.employeeName || 'Employee').replace(/[^a-zA-Z0-9_-]/g, '_')
    const period = range.label.replace(/[^a-zA-Z0-9_-]/g, '_')
    XLSX.writeFile(wb, `${empName}_Attendance_${period}.xlsx`)
  }

  // Status uses the same P / A / H / O notation as the attendance grid, so the
  // two screens read alike. The star and calendar glyphs that used to be here
  // looked decorative rather than like data.
  function renderTableStatus(status, holidayName) {
    const label =
      status === 'Holiday' ? (holidayName || 'Holiday')
        : status === 'Day Off' ? 'Weekly off'
          : status === 'Upcoming' ? 'Not due yet'
            : status === 'Not Joined' ? 'Before joining'
              : status

    const tone =
      status === 'Present' ? 'text-emerald-700'
        : status === 'Half Day' ? 'text-amber-700'
          : status === 'Absent' ? 'text-rose-600'
            : status === 'Holiday' ? 'text-violet-700'
              : status === 'Day Off' ? 'text-slate-500'
                : 'text-slate-400'

    return (
      <span className={`inline-flex items-center gap-2 font-medium ${tone}`} title={label}>
        <StatusMark status={status} />
        <span className="max-w-[110px] truncate">{label}</span>
      </span>
    )
  }

  return (
    <div className="space-y-4 pb-12">
      {/* Top Header: Summary Report Back Link (Left) + Standard Toggle & Export Table (Right) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/reports/summary"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors"
          >
            <FaArrowLeft className="h-3 w-3 text-slate-500" />
            <span>Summary Report</span>
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <h1 className="text-base font-bold text-slate-800 truncate">
            {employee?.employeeName ? `${employee.employeeName} — Attendance Report` : 'Employee Attendance Report'}
          </h1>
        </div>

        {/* Right side: Standard DateToggle & Export Table Button */}
        <div className="flex items-center gap-2">
          <DateToggle />

          <button
            type="button"
            onClick={exportTableXlsx}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors cursor-pointer"
            title="Export Day-by-Day Attendance Table to Excel"
          >
            <FaFileExcel className="h-3.5 w-3.5 text-emerald-600" />
            <span>Export Table</span>
          </button>
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {/* Main Content Grid: Left (Profile & Today) + Right (KPIs & Compact Calendar) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* ── LEFT COLUMN (Profile Card & Today's Attendance) ──────── */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-3">
          {/* Employee Profile Card */}
          <Card className="p-3.5 relative overflow-hidden">
            <div className="flex items-center gap-3">
              {/* Photo / Avatar */}
              <div className="relative shrink-0">
                {employee?.photoUrl ? (
                  <img
                    src={employee.photoUrl}
                    alt={employee.employeeName}
                    className="h-12 w-12 rounded-xl object-cover ring-2 ring-slate-100 shadow-2xs"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 font-bold text-base text-white shadow-2xs">
                    {employee?.employeeName
                      ?.split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join('')
                      .toUpperCase() || <FaUser className="h-5 w-5 text-sky-100" />}
                  </div>
                )}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                    employee?.isActive ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                  title={employee?.isActive ? 'Active Employee' : 'Inactive'}
                />
              </div>

              {/* Name & ID */}
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-slate-800 truncate">
                  {employee?.employeeName || 'Loading…'}
                </h2>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="font-mono text-[11px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                    ID: {employee?.biometricUserId || `#${id}`}
                  </span>
                  <Badge tone={employee?.isActive ? 'green' : 'slate'}>
                    {employee?.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {employee?.title && (
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500 truncate">{employee.title}</p>
                )}
              </div>
            </div>

            <hr className="my-2.5 border-slate-100" />

            {/* HR Info Fields */}
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between py-0.5 border-b border-slate-50">
                <span className="text-slate-400 flex items-center gap-1.5 text-[11px]">
                  <FaBuilding className="h-3 w-3 text-slate-400" /> Department
                </span>
                <span className="font-medium text-slate-700 truncate max-w-[130px]">{departmentName}</span>
              </div>

              {employee?.branchName && (
                <div className="flex items-center justify-between py-0.5 border-b border-slate-50">
                  <span className="text-slate-400 flex items-center gap-1.5 text-[11px]">
                    <FaBriefcase className="h-3 w-3 text-slate-400" /> Branch
                  </span>
                  <span className="font-medium text-slate-700 truncate max-w-[130px]">{employee.branchName}</span>
                </div>
              )}

              {employee?.phoneNumber && (
                <div className="flex items-center justify-between py-0.5 border-b border-slate-50">
                  <span className="text-slate-400 flex items-center gap-1.5 text-[11px]">
                    <FaPhone className="h-3 w-3 text-slate-400" /> Phone
                  </span>
                  <a
                    href={`tel:${employee.phoneNumber}`}
                    className="font-medium text-sky-600 hover:underline"
                  >
                    {employee.phoneNumber}
                  </a>
                </div>
              )}

              {employee?.email && (
                <div className="flex items-center justify-between py-0.5 border-b border-slate-50">
                  <span className="text-slate-400 flex items-center gap-1.5 text-[11px]">
                    <FaEnvelope className="h-3 w-3 text-slate-400" /> Email
                  </span>
                  <a
                    href={`mailto:${employee.email}`}
                    className="font-medium text-sky-600 hover:underline truncate max-w-[130px]"
                    title={employee.email}
                  >
                    {employee.email}
                  </a>
                </div>
              )}

              <div className="flex items-center justify-between py-0.5">
                <span className="text-slate-400 flex items-center gap-1.5 text-[11px]">
                  <FaCalendarAlt className="h-3 w-3 text-slate-400" /> Hire Date
                </span>
                <span className="font-medium text-slate-700 text-[11px]">
                  {isBs
                    ? (employee?.hireDateBs ? `${employee.hireDateBs} BS` : '—')
                    : (employee?.hireDate ? `${ymd(employee.hireDate)} AD` : '—')}
                </span>
              </div>
            </div>
          </Card>

          {/* Today's Attendance Widget */}
          <Card className="p-3 bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <div className="p-1 bg-slate-100 text-slate-600 rounded-md">
                  <FaCalendarDay className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">
                    Today&apos;s Status
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    {isBs && todayBs ? `${todayBs.str} BS` : `${todayIso} AD`}
                  </p>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${todayStatusInfo.badgeColor}`}>
                {todayStatusInfo.label}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-lg p-2 border border-slate-100 text-center">
              <div className="border-r border-slate-200/70 pr-1">
                <div className="text-[9px] uppercase font-semibold text-slate-400">Check In</div>
                <div className="text-xs font-bold text-slate-700 mt-0.5">
                  {todayStatusInfo.firstIn || '—'}
                </div>
              </div>
              <div className="pl-1">
                <div className="text-[9px] uppercase font-semibold text-slate-400">Check Out</div>
                <div className="text-xs font-bold text-slate-700 mt-0.5">
                  {todayStatusInfo.lastOut || '—'}
                </div>
              </div>
            </div>

            {todayLog && todayLog.count > 0 && (
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">
                  Scans: <b className="text-slate-700">{todayLog.count}</b>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDetailModal({
                      date: todayIso,
                      dateBs: todayBs?.dateBs,
                    })
                  }
                  className="font-semibold text-sky-600 hover:text-sky-700 underline cursor-pointer"
                >
                  View Punches
                </button>
              </div>
            )}
          </Card>
        </div>

        {/* ── RIGHT COLUMN (KPIs & Ultra-Compact Clean Calendar Grid) ─ */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-3">
          {/* Monthly KPI Overview Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Card className="p-2 text-center border-t-2 border-t-slate-400">
              <div className="text-[10px] font-medium text-slate-500">Working Days</div>
              <div className="mt-0.5 text-base font-bold text-slate-800">{stats.workingDays}</div>
            </Card>
            <Card className="p-2 text-center border-t-2 border-t-emerald-500">
              <div className="text-[10px] font-medium text-emerald-600">Present Days</div>
              <div className="mt-0.5 text-base font-bold text-emerald-600">{stats.presentDays}</div>
            </Card>
            <Card className="p-2 text-center border-t-2 border-t-rose-500">
              <div className="text-[10px] font-medium text-rose-500">Absent Days</div>
              <div className="mt-0.5 text-base font-bold text-rose-500">{stats.absentDays}</div>
            </Card>
            <Card className="p-2 text-center border-t-2 border-t-amber-500">
              <div className="text-[10px] font-medium text-amber-600">Half Days</div>
              <div className="mt-0.5 text-base font-bold text-amber-600">{stats.halfDays}</div>
            </Card>
            <Card className="p-2 text-center border-t-2 border-t-sky-500">
              <div className="text-[10px] font-medium text-sky-600">Holidays/Off</div>
              <div className="mt-0.5 text-base font-bold text-sky-600">{stats.holidays}</div>
            </Card>
            <Card className="p-2 text-center border-t-2 border-t-indigo-500">
              <div className="text-[10px] font-medium text-indigo-600">Total Hours</div>
              <div className="mt-0.5 text-base font-bold text-indigo-600">{stats.totalHours}h</div>
            </Card>
          </div>

          {/* Ultra-Compact Clean Calendar Card */}
          <Card className="p-3 sm:p-3.5">
            {/* Calendar Header with Month/Year Navigation (clean title without AD/BS mix) */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-slate-100 text-slate-700 rounded-md">
                  <MdCalendarMonth className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-800 leading-tight">
                  {range.label}
                </h3>
              </div>

              {/* Month Navigation Controls */}
              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
                  title="Previous Month"
                >
                  <FaChevronLeft className="h-2.5 w-2.5" />
                </button>

                {/* Month Dropdown */}
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-2xs focus:border-sky-500 focus:outline-none"
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.name}
                    </option>
                  ))}
                </select>

                {/* Year Dropdown */}
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-2xs focus:border-sky-500 focus:outline-none"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={nextMonth}
                  disabled={isAtLatest}
                  className={`p-1 rounded-md border border-slate-200 transition-colors ${
                    isAtLatest
                      ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400'
                      : 'bg-white hover:bg-slate-50 text-slate-600 cursor-pointer'
                  }`}
                  title={isAtLatest ? 'Cannot select future month' : 'Next Month'}
                >
                  <FaChevronRight className="h-2.5 w-2.5" />
                </button>

                <button
                  type="button"
                  onClick={jumpToCurrentMonth}
                  className="ml-0.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Today
                </button>
              </div>
            </div>

            {/* Clean Status Legend Matching Iconic Attendance Format */}
            <div className="my-2 flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
              <span className="font-semibold text-slate-700 mr-0.5">Note:</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Present</span>
              </span>
              <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span>Absent</span>
              </span>
              <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                <span className="text-[9px] font-bold text-violet-600">H</span>
                <span>Holiday</span>
              </span>
              <span className="inline-flex items-center gap-1 text-sky-600 font-medium">
                <span className="h-2 w-2 rounded-full bg-sky-500" />
                <span>Day Off</span>
              </span>
              <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span>Half Day</span>
              </span>
            </div>

            {loading && <p className="py-6 text-center text-xs text-slate-400">Loading monthly attendance…</p>}

            {/* Small, Clean, Non-overcolored Calendar Grid */}
            {!loading && (
              <>
                {/* Weekday Headers */}
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500 mb-1">
                  {WD.map((w, idx) => (
                    <div
                      key={w}
                      className={`py-0.5 rounded ${idx === 6 ? 'text-sky-600 font-bold bg-sky-50/50' : 'bg-slate-50'}`}
                    >
                      {w}
                    </div>
                  ))}
                </div>

                {/* Day Cells: Small, crisp, showing check-in & check-out time without writing Present/Absent */}
                <div className="grid grid-cols-7 gap-1">
                  {calendarCells.map((c) => {
                    if (c.empty) {
                      return <div key={c.key} className="h-11 sm:h-12 rounded bg-slate-50/30 border border-slate-100" />
                    }

                    const cell = c.cell
                    const meta = c.meta
                    const isWeeklyOff = meta?.isHoliday && (meta?.holidayName === 'Weekly off' || meta?.holidayName?.toLowerCase().includes('off'))
                    const isHoliday = meta?.isHoliday && !isWeeklyOff

                    const clickable = cell && (cell.status === 'Present' || cell.punchCount > 0)

                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() =>
                          clickable &&
                          setDetailModal({
                            date: c.dateIso,
                            dateBs: c.dateBs,
                          })
                        }
                        disabled={!clickable}
                        className={`group relative flex h-11 sm:h-12 flex-col justify-between p-1 rounded-md border text-left transition-all ${
                          c.isToday
                            ? 'border-sky-500 ring-2 ring-sky-500/25 bg-sky-50/15'
                            : 'bg-white border-slate-200/90 hover:border-slate-300'
                        } ${clickable ? 'cursor-pointer hover:bg-slate-50/80' : 'cursor-default'}`}
                        title={
                          meta
                            ? `${isBs ? (c.dateBs || c.dateIso) : c.dateIso}${meta.holidayName ? ` — ${meta.holidayName}` : ''}${cell ? ` [${cell.status}]` : ''}`
                            : c.dateIso
                        }
                      >
                        {/* Top: Only the single day number + subtle status dot/icon */}
                        <div className="flex items-center justify-between w-full leading-none">
                          <span className={`text-[11px] font-bold ${c.isToday ? 'text-sky-600' : 'text-slate-700'}`}>
                            {c.dayNum}
                          </span>

                          {/* Subtle status indicator dot or icon — no words */}
                          {cell?.status === 'Present' ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Present" />
                          ) : cell?.status === 'Absent' ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" title="Absent" />
                          ) : isWeeklyOff || cell?.status === 'Day Off' || cell?.status === 'Weekly off' ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" title="Day Off" />
                          ) : isHoliday || cell?.status === 'Holiday' ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" title={meta?.holidayName || 'Holiday'} />
                          ) : cell?.status === 'Half Day' || (cell?.hours > 0 && cell?.hours < 4) ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Half Day" />
                          ) : null}
                        </div>

                        {/* Bottom: Check-in & Check-out time (compact, no "Present"/"Absent" text) */}
                        <div className="w-full truncate text-[9px] leading-tight font-mono text-slate-500">
                          {cell?.status === 'Present' || (cell?.hours > 0) ? (
                            <span className="text-slate-700 font-medium">
                              {hm(cell.firstIn)}{cell.lastOut ? `–${hm(cell.lastOut)}` : ''}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* ── BOTTOM SECTION: Day-by-Day Attendance Log Table ────────── */}
      <Card className="p-3.5 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-100 text-slate-700 rounded-md">
              <RiFileList3Line className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                Day-by-Day Attendance Log
              </h3>
              <p className="text-xs text-slate-400">
                Breakdown for {range.label} ({tableRows.length} entries)
              </p>
            </div>
          </div>

          {/* Table Filters & Quick Export */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              {[
                ['all', 'All Days'],
                ['present', 'Present'],
                ['absent', 'Absent'],
                ['holiday', 'Holidays/Off'],
              ].map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTableFilter(f)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                    tableFilter === f ? 'bg-white text-slate-800 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={exportTableXlsx}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-2xs hover:bg-emerald-50 hover:border-emerald-300 transition-colors cursor-pointer"
              title="Export this table to Excel"
            >
              <FaFileExcel className="h-3 w-3 text-emerald-600" />
              <span>Export</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-semibold">
                <th className="px-3.5 py-2.5 text-left whitespace-nowrap">
                  {isBs ? 'Date (BS)' : 'Date (AD)'}
                </th>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">Day</th>
                <th className="px-3 py-2.5 text-center whitespace-nowrap">Status</th>
                <th className="px-3 py-2.5 text-center whitespace-nowrap">Check In</th>
                <th className="px-3 py-2.5 text-center whitespace-nowrap">Check Out</th>
                <th className="px-3 py-2.5 text-center whitespace-nowrap">Hours</th>
                <th className="px-3 py-2.5 text-center whitespace-nowrap">Scans</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tableRows.map((r) => (
                <tr key={r.dateIso} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-3.5 py-2 font-medium text-slate-800 whitespace-nowrap font-mono">
                    {isBs ? bsDmy(r.dateBs) || dmy(r.dateIso) : dmy(r.dateIso)}
                  </td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    {r.weekday}
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    {renderTableStatus(r.resolvedStatus, r.holidayName)}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-slate-700 whitespace-nowrap">
                    {r.firstIn}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-slate-700 whitespace-nowrap">
                    {r.lastOut}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-800 whitespace-nowrap">
                    {r.hours > 0 ? `${r.hours}h` : '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-500 whitespace-nowrap">
                    {r.punchCount > 0 ? r.punchCount : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.punchCount > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDetailModal({
                            date: r.dateIso,
                            dateBs: r.dateBs,
                          })
                        }
                        className="font-semibold text-sky-600 hover:text-sky-800 transition-colors cursor-pointer"
                      >
                        View Scans
                      </button>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No attendance entries matching the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Raw Punches Detail Modal */}
      {detailModal && (
        <DayDetailModal
          employeeId={id}
          employeeName={employee?.employeeName || 'Employee'}
          date={detailModal.date}
          dateBs={detailModal.dateBs}
          onClose={() => setDetailModal(null)}
        />
      )}
    </div>
  )
}
