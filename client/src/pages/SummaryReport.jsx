import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MdCalendarMonth } from 'react-icons/md'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { overview, departments as deptApi } from '../api/resources'
import { useAsync } from '../hooks/useAsync'
import { apiErrorMessage } from '../lib/errors'
import { ymd } from '../lib/dates'
import { PageHeader, Card, Field, Select, Button, ErrorText } from '../components/ui'
import EmployeeCalendarModal from '../components/EmployeeCalendarModal'
import { useCalendar } from '../context/CalendarContext'
import DateToggle from '../components/DateToggle'
import { adToBs, MONTH_NAMES_EN, getDaysInBsMonth } from '../lib/nepaliCalendar'
import NepaliDatePicker, { bsToAdIso } from '../components/NepaliDatePicker'
import ReportTabs from '../components/ReportTabs'

const iso = (d) => ymd(d)
const pad = (n) => String(n).padStart(2, '0')

const AD_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function SummaryReport() {
  const { isBs } = useCalendar()
  const today = useMemo(() => new Date(), [])
  const todayBs = useMemo(() => adToBs(today), [today])

  // Distinct Year and Month states
  const [selectedYear, setSelectedYear] = useState(() =>
    isBs ? todayBs?.year || 2083 : today.getFullYear()
  )
  const [selectedMonth, setSelectedMonth] = useState(() =>
    isBs ? todayBs?.month || 5 : today.getMonth() + 1
  )

  // Department filter
  const [departmentId, setDepartmentId] = useState('')

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [calendarFor, setCalendarFor] = useState(null)

  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef(null)

  const { data: deptList } = useAsync(() => deptApi.list(), [])

  // Close export dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Sync year and month when switching calendar mode (AD <-> BS)
  useEffect(() => {
    if (isBs) {
      const bs = adToBs(today)
      setSelectedYear(bs?.year || 2083)
      setSelectedMonth(bs?.month || 5)
    } else {
      setSelectedYear(today.getFullYear())
      setSelectedMonth(today.getMonth() + 1)
    }
  }, [isBs, today])

  const currentYear = useMemo(() => {
    return isBs ? Number(todayBs?.year) || 2083 : today.getFullYear()
  }, [isBs, today, todayBs])

  const currentMonth = useMemo(() => {
    return isBs ? Number(todayBs?.month) || 5 : today.getMonth() + 1
  }, [isBs, today, todayBs])

  // Year options: current year and prior years (future years restricted)
  const yearOptions = useMemo(() => {
    return [currentYear, currentYear - 1, currentYear - 2, currentYear - 3]
  }, [currentYear])

  // Month options: capped at current month if current year is selected
  const monthOptions = useMemo(() => {
    const names = isBs ? MONTH_NAMES_EN : AD_MONTHS
    const maxMonth = Number(selectedYear) === currentYear ? currentMonth : 12
    return names
      .map((name, idx) => ({
        value: idx + 1,
        label: name,
      }))
      .filter((opt) => opt.value <= maxMonth)
  }, [isBs, selectedYear, currentYear, currentMonth])

  // Clamp selected year and month if they exceed current year/month
  useEffect(() => {
    if (Number(selectedYear) > currentYear) {
      setSelectedYear(currentYear)
    } else if (Number(selectedYear) === currentYear && Number(selectedMonth) > currentMonth) {
      setSelectedMonth(currentMonth)
    }
  }, [selectedYear, selectedMonth, currentYear, currentMonth])

  // Compute active date range (always monthly)
  const range = useMemo(() => {
    const year = Number(selectedYear)
    const month = Number(selectedMonth)

    const isCurrent = isBs
      ? year === Number(todayBs?.year) && month === Number(todayBs?.month)
      : year === today.getFullYear() && month === today.getMonth() + 1

    if (isBs) {
      const fromIso = bsToAdIso(year, month, 1)
      const days = getDaysInBsMonth(year, month)
      const fullToIso = bsToAdIso(year, month, days)
      const toIso = isCurrent ? iso(today) : fullToIso
      return {
        from: fromIso,
        to: toIso,
        fullTo: fullToIso,
        isCurrent,
        label: `${MONTH_NAMES_EN[month - 1] || 'Month'} ${year} BS`,
      }
    }

    const fromIso = `${year}-${pad(month)}-01`
    const daysInMonth = new Date(year, month, 0).getDate()
    const fullToIso = `${year}-${pad(month)}-${pad(daysInMonth)}`
    const toIso = isCurrent ? iso(today) : fullToIso
    return {
      from: fromIso,
      to: toIso,
      fullTo: fullToIso,
      isCurrent,
      label: `${AD_MONTHS[month - 1] || ''} ${year}`,
    }
  }, [selectedYear, selectedMonth, isBs, today, todayBs])

  // Auto-fetch summary data with debounce
  useEffect(() => {
    const id = setTimeout(() => {
      setLoading(true)
      setError('')
      const params = { from: range.from, to: range.to }
      if (departmentId) params.departmentId = departmentId
      overview
        .summary(params)
        .then(setData)
        .catch((e) => setError(apiErrorMessage(e)))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(id)
  }, [range.from, range.to, departmentId])

  // Flatten employees across all departments (no separation row)
  const rows = useMemo(() => {
    if (!data?.departments) return []
    return data.departments.flatMap((dept) =>
      dept.employees.map((e) => ({
        ...e,
        departmentName: dept.departmentName,
      }))
    )
  }, [data])

  function exportXlsx() {
    if (!data) return
    const head = [
      'Employee ID',
      'Employee',
      'Department',
      range.isCurrent ? 'Working Days (Up to Today)' : 'Working Days',
      'Present Days',
      'Absent Days',
      'Total Hours',
      'Earliest In',
      'Latest Out',
      'Avg In',
      'Avg Out',
    ]
    const body = [head]
    for (const r of rows) {
      body.push([
        r.biometricUserId || '—',
        r.employeeName,
        r.departmentName || '',
        data.workingDays ?? '—',
        r.presentDays,
        r.absentDays,
        r.totalHours,
        r.earliestIn || '',
        r.latestOut || '',
        r.avgIn || '',
        r.avgOut || '',
      ])
    }
    const ws = XLSX.utils.aoa_to_sheet(body)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Summary')
    XLSX.writeFile(wb, `attendance_summary_${range.from}_to_${range.to}.xlsx`)
  }

  function exportPdf() {
    if (!data) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    doc.setFontSize(14)
    doc.setTextColor(15, 23, 42)
    doc.text('Attendance Summary Report', 14, 13)

    const workingDaysLabel = range.isCurrent
      ? `Working Days (Up to Today): ${data.workingDays}`
      : `Total Working Days: ${data.workingDays}`

    doc.setFontSize(8.5)
    doc.setTextColor(100, 116, 139)
    doc.text(
      `Period: ${range.label} (${range.from} to ${range.to})  |  ${workingDaysLabel}  |  Generated: ${new Date().toLocaleDateString()}`,
      14,
      18,
    )

    const head = [
      [
        'Employee ID',
        'Employee',
        'Department',
        range.isCurrent ? 'Working Days (Up to Today)' : 'Working Days',
        'Present',
        'Absent',
        'Total Hours',
        'Earliest In',
        'Latest Out',
        'Avg In',
        'Avg Out',
      ],
    ]

    const body = []
    for (const r of rows) {
      body.push([
        r.biometricUserId || '—',
        r.employeeName,
        r.departmentName || '',
        String(data.workingDays ?? '—'),
        String(r.presentDays),
        String(r.absentDays),
        String(r.totalHours),
        r.earliestIn || '—',
        r.latestOut || '—',
        r.avgIn || '—',
        r.avgOut || '—',
      ])
    }

    autoTable(doc, {
      head,
      body,
      startY: 22,
      styles: { fontSize: 7.5, cellPadding: 2, halign: 'center', valign: 'middle' },
      columnStyles: {
        0: { halign: 'left', fontStyle: 'bold', cellWidth: 26 },
        1: { halign: 'left', fontStyle: 'bold', cellWidth: 34 },
        2: { halign: 'left', cellWidth: 28 },
        3: { halign: 'center', fontStyle: 'bold', cellWidth: 22 },
        4: { halign: 'center', textColor: [22, 101, 52] },
        5: { halign: 'center', textColor: [185, 28, 28] },
      },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { top: 22, left: 10, right: 10, bottom: 10 },
    })

    doc.save(`attendance_summary_${range.from}_to_${range.to}.pdf`)
  }

  const subtitle = data
    ? isBs
      ? `${data.fromBs} to ${data.toBs} BS · ${data.workingDays} working days${range.isCurrent ? ' (up to today)' : ''} · ${data.employeeCount} employees`
      : `${range.from} to ${range.to} AD · ${data.workingDays} working days${range.isCurrent ? ' (up to today)' : ''} · ${data.employeeCount} employees`
    : undefined

  return (
    <div>
      <PageHeader
        title="Summary Report"
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-5">
            {/* Export Dropdown with .xlsx and .pdf */}
            <div className="relative" ref={exportRef}>
              <button
                type="button"
                onClick={() => setExportOpen((o) => !o)}
                disabled={!data || rows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>Export</span>
                <span className="text-xs">▾</span>
              </button>

              {exportOpen && (
                <div className="absolute right-0 z-50 mt-1 w-28 rounded-md border border-slate-200 bg-white py-1 shadow-md">
                  <button
                    type="button"
                    onClick={() => {
                      setExportOpen(false)
                      exportXlsx()
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-green-700 transition"
                  >
                    .xlsx
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportOpen(false)
                      exportPdf()
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-rose-700 transition"
                  >
                    .pdf
                  </button>
                </div>
              )}
            </div>

            {/* AD / BS Mode Toggle with clear visual gap */}
            <DateToggle />
          </div>
        }
      />

      <ReportTabs />

      {/* Filter Bar */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-4">

          {/* Month Dropdown */}
          <div className="w-48">
            <Field label="Month">
              <Select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
              >
                {monthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Small Year Dropdown */}
          <div className="w-28">
            <Field label="Year">
              <Select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}{isBs ? ' BS' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Department */}
          <div className="min-w-[180px]">
            <Field label="Department">
              <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">All departments</option>
                {(deptList || []).map((d) => (
                  <option key={d.departmentId} value={d.departmentId}>
                    {d.departmentName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Reset */}
          <div>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setDepartmentId('')
                if (isBs) {
                  const bs = adToBs(today)
                  setSelectedYear(bs?.year || 2083)
                  setSelectedMonth(bs?.month || 5)
                } else {
                  setSelectedYear(today.getFullYear())
                  setSelectedMonth(today.getMonth() + 1)
                }
              }}
            >
              Reset
            </Button>
          </div>

        </div>
      </Card>

      {error && <ErrorText>{error}</ErrorText>}
      {loading && <p className="py-2 text-sm text-slate-400">Loading…</p>}

      {/* Summary KPI Cards */}
      {data && !loading && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3.5">
            <div className="text-xs font-medium text-slate-500">
              {range.isCurrent ? 'Working Days (Up to Today)' : 'Total Working Days'}
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-800">
              {data.workingDays}{' '}
              <span className="text-xs font-normal text-slate-500">days</span>
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="text-xs font-medium text-slate-500">Total Employees</div>
            <div className="mt-1 text-2xl font-bold text-slate-800">{data.employeeCount}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-xs font-medium text-slate-500">Avg Present Days</div>
            <div className="mt-1 text-2xl font-bold text-green-600">
              {rows.length > 0
                ? (rows.reduce((acc, r) => acc + (r.presentDays || 0), 0) / rows.length).toFixed(1)
                : 0}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="text-xs font-medium text-slate-500">Overall Attendance</div>
            <div className="mt-1 text-2xl font-bold text-sky-600">
              {data.workingDays > 0 && rows.length > 0
                ? `${Math.round(
                    (rows.reduce((acc, r) => acc + (r.presentDays || 0), 0) /
                      (rows.length * data.workingDays)) *
                      100
                  )}%`
                : '—'}
            </div>
          </Card>
        </div>
      )}

      {/* Unified Table without department separation banner */}
      {data && !loading && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600">
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">
                  Employee ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">
                  Employee
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">
                  Department
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-700 whitespace-nowrap">
                  <div>Working Days</div>
                  {range.isCurrent && (
                    <div className="text-[10px] font-normal text-slate-400 leading-tight">
                      (up to today)
                    </div>
                  )}
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-green-600 whitespace-nowrap">
                  Present
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-red-500 whitespace-nowrap">
                  Absent
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold whitespace-nowrap">
                  Hours
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold whitespace-nowrap">
                  Earliest in
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold whitespace-nowrap">
                  Latest out
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold whitespace-nowrap">
                  Avg in
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold whitespace-nowrap">
                  Avg out
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold whitespace-nowrap">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => (
                <tr key={e.employeeId} className="hover:bg-slate-50 transition-colors">
                  {/* Employee ID in front */}
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                    {e.biometricUserId || '—'}
                  </td>

                  {/* Employee name link to individual report */}
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <Link
                      to={`/reports/employee/${e.employeeId}?cal=${isBs ? 'bs' : 'ad'}&year=${selectedYear}&month=${selectedMonth}`}
                      className="font-semibold text-slate-800 hover:text-sky-600 transition-colors cursor-pointer"
                      title="View individual employee attendance report"
                    >
                      {e.employeeName}
                    </Link>
                  </td>

                  {/* Department Name */}
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {e.departmentName || '—'}
                  </td>

                  {/* Total Working Days for the month */}
                  <td className="px-3 py-2.5 text-center text-sm font-semibold text-slate-700">
                    {data.workingDays}
                  </td>

                  <td className="px-3 py-2.5 text-center text-sm font-semibold text-green-600">
                    {e.presentDays}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm font-semibold text-red-500">
                    {e.absentDays}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm font-medium text-slate-700">
                    {e.totalHours}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-slate-600">
                    {e.earliestIn || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-slate-600">
                    {e.latestOut || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-slate-500">
                    {e.avgIn || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-slate-500">
                    {e.avgOut || '—'}
                  </td>

                  {/* Individual Report Action Button */}
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Link
                      to={`/reports/employee/${e.employeeId}?cal=${isBs ? 'bs' : 'ad'}&year=${selectedYear}&month=${selectedMonth}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-600 shadow-2xs hover:bg-sky-50 hover:border-sky-300 transition-all"
                      title="Open Individual Report & Calendar"
                    >
                      <MdCalendarMonth className="h-3.5 w-3.5 text-sky-500" />
                      <span>Report</span>
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                    No attendance records found for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {calendarFor && (
        <EmployeeCalendarModal
          employeeId={calendarFor.employeeId}
          employeeName={calendarFor.employeeName}
          onClose={() => setCalendarFor(null)}
        />
      )}
    </div>
  )
}
