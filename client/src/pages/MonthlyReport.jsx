import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { dailyAttendance as api, departments as deptApi } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { dmy, bsDmy, todayIso } from '../lib/dates'
import { adToBs } from '../lib/nepaliCalendar'
import { PageHeader, Card, Button, ErrorText, Select } from '../components/ui'
import { useFeedback } from '../components/feedback'
import { useAuth } from '../context/AuthContext'
import { useCalendar } from '../context/CalendarContext'
import DateToggle from '../components/DateToggle'
import NepaliDatePicker from '../components/NepaliDatePicker'
import ReportTabs from '../components/ReportTabs'

/** P / L / PT / A / H, coloured. Same notation as the attendance grid. */
const MARK_STYLE = {
  P: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  L: 'bg-amber-50 text-amber-700 ring-amber-200',
  PT: 'bg-sky-50 text-sky-700 ring-sky-200',
  A: 'bg-rose-50 text-rose-700 ring-rose-200',
  H: 'bg-violet-50 text-violet-600 ring-violet-200',
  '-': 'bg-white text-slate-300 ring-slate-100',
  '': 'bg-white text-slate-200 ring-slate-100',
}

export default function MonthlyReport() {
  const fb = useFeedback()
  const { role } = useAuth()
  const { isBs } = useCalendar()
  const isAdmin = role === 'Admin'

  const [range, setRange] = useState(() => {
    const now = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return {
      from: `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`,
      to: todayIso(),
    }
  })
  const [departmentId, setDepartmentId] = useState('')
  const [depts, setDepts] = useState([])

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [emailReady, setEmailReady] = useState(null)

  useEffect(() => {
    deptApi.list().then(setDepts).catch(() => setDepts([]))
    api.emailStatus().then(setEmailReady).catch(() => setEmailReady({ configured: false }))
  }, [])

  const load = useCallback(() => {
    setError('')
    setData(null)
    api
      .monthly({ from: range.from, to: range.to, departmentId: departmentId || undefined })
      .then(setData)
      .catch((e) => {
        setError(apiErrorMessage(e))
        setData({ dates: [], rows: [], holidayDates: [] })
      })
  }, [range.from, range.to, departmentId])

  useEffect(load, [load])

  const holidaySet = useMemo(() => new Set(data?.holidayDates ?? []), [data])

  /** Excel export, built from the same data on screen. */
  function exportExcel() {
    if (!data?.rows?.length) return

    const header = [
      'Employee',
      'Department',
      'Device ID',
      ...data.dates.map((d) => (isBs ? bsDmy(adToBs(d)?.dateBs) : dmy(d))),
      'Present',
      'Late',
      'Partial',
      'Absent',
      'Hours',
    ]

    const body = data.rows.map((r) => [
      r.employeeName,
      r.departmentName || '',
      r.deviceUserId || '',
      ...data.dates.map((d) => r.marks?.[d] ?? ''),
      r.totalPresent,
      r.totalLate,
      r.totalPartial,
      r.totalAbsent,
      r.totalHours,
    ])

    const legend = [[], ['P = Present', 'L = Late', 'PT = Partial', 'A = Absent', 'H = Holiday']]

    const sheet = XLSX.utils.aoa_to_sheet([header, ...body, ...legend])

    // Employee names need room; date columns are one or two characters.
    sheet['!cols'] = [
      { wch: 24 },
      { wch: 16 },
      { wch: 10 },
      ...data.dates.map(() => ({ wch: 5 })),
      { wch: 8 },
      { wch: 6 },
      { wch: 7 },
      { wch: 7 },
      { wch: 8 },
    ]

    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Attendance')
    XLSX.writeFile(book, `attendance_summary_${range.from}_to_${range.to}.xlsx`)
    fb.success('Excel file downloaded')
  }

  async function runProcess(sendEmails) {
    if (sendEmails) {
      const ok = await fb.confirm({
        title: 'Send attendance emails',
        message: 'Every employee with an email address gets their own attendance for today. Continue?',
        confirmText: 'Send',
      })
      if (!ok) return
    }

    setBusy(sendEmails ? 'emails' : 'process')
    try {
      const res = sendEmails ? await api.sendEmails() : await api.process(false)
      fb.success(res.message)
      load()
    } catch (err) {
      fb.error(apiErrorMessage(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <PageHeader
        title="Monthly Report"
        subtitle="Employees down, dates across"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateToggle />
            <NepaliDatePicker
              value={range.from}
              onChange={(from) => setRange((r) => ({ ...r, from }))}
              className="w-40"
            />
            <NepaliDatePicker
              value={range.to}
              onChange={(to) => setRange((r) => ({ ...r, to }))}
              className="w-40"
            />
          </div>
        }
      />

      <ReportTabs />

      {error && <ErrorText>{error}</ErrorText>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-48"
          >
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d.departmentId} value={d.departmentId}>
                {d.departmentName}
              </option>
            ))}
          </Select>

          <span className="flex flex-wrap items-center gap-2 text-xs">
            {['P', 'L', 'PT', 'A', 'H'].map((m) => (
              <span key={m} className="inline-flex items-center gap-1">
                <Mark value={m} />
                <span className="text-slate-500">
                  {{ P: 'Present', L: 'Late', PT: 'Partial', A: 'Absent', H: 'Holiday' }[m]}
                </span>
              </span>
            ))}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={exportExcel} disabled={!data?.rows?.length}>
            Export Excel
          </Button>
          {isAdmin && (
            <>
              <Button variant="secondary" onClick={() => runProcess(false)} disabled={Boolean(busy)}>
                {busy === 'process' ? 'Processing...' : "Process today's attendance"}
              </Button>
              <Button
                onClick={() => runProcess(true)}
                disabled={Boolean(busy) || emailReady?.configured === false}
                title={
                  emailReady?.configured === false
                    ? 'Set the SMTP host and from-address in Settings first'
                    : undefined
                }
              >
                {busy === 'emails' ? 'Sending...' : 'Send attendance emails'}
              </Button>
            </>
          )}
        </div>
      </div>

      {emailReady?.configured === false && isAdmin && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          Email is not configured. Add the SMTP settings before sending.
        </p>
      )}

      <Card className="overflow-hidden">
        {!data ? (
          <p className="py-16 text-center text-sm text-slate-400">Loading...</p>
        ) : data.rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">
            {error ? 'Could not load the report.' : 'No employees in this range.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium">
                    Employee
                  </th>
                  {data.dates.map((d) => {
                    const bs = adToBs(d)
                    const off = holidaySet.has(d)
                    return (
                      <th
                        key={d}
                        title={`${dmy(d)} AD / ${bsDmy(bs?.dateBs)} BS`}
                        className={`border-b border-l border-slate-100 px-1 py-2 text-center text-[10px] font-medium tabular-nums ${
                          off ? 'bg-slate-100 text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        {isBs ? bs?.day : new Date(d).getDate()}
                      </th>
                    )
                  })}
                  <th className="border-b border-l-2 border-slate-200 px-2 py-2 text-center font-medium">P</th>
                  <th className="border-b border-l border-slate-100 px-2 py-2 text-center font-medium">L</th>
                  <th className="border-b border-l border-slate-100 px-2 py-2 text-center font-medium">PT</th>
                  <th className="border-b border-l border-slate-100 px-2 py-2 text-center font-medium">A</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.employeeId} className="group hover:bg-slate-50/70">
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-1.5 group-hover:bg-slate-50/90">
                      <div className="whitespace-nowrap font-medium text-slate-800">{r.employeeName}</div>
                      <div className="truncate text-xs text-slate-400">{r.departmentName}</div>
                    </td>
                    {data.dates.map((d) => (
                      <td key={d} className="border-l border-slate-50 px-0.5 py-1.5 text-center">
                        <Mark value={r.marks?.[d] ?? ''} />
                      </td>
                    ))}
                    <td className="border-l-2 border-slate-200 px-2 py-1.5 text-center font-semibold tabular-nums text-emerald-700">
                      {r.totalPresent}
                    </td>
                    <td className="border-l border-slate-100 px-2 py-1.5 text-center tabular-nums text-amber-700">
                      {r.totalLate}
                    </td>
                    <td className="border-l border-slate-100 px-2 py-1.5 text-center tabular-nums text-sky-700">
                      {r.totalPartial}
                    </td>
                    <td className="border-l border-slate-100 px-2 py-1.5 text-center font-semibold tabular-nums text-rose-600">
                      {r.totalAbsent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data?.workingDays > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {data.workingDays} working days in this range. Blank cells are days that have not finished.
        </p>
      )}
    </div>
  )
}

function Mark({ value }) {
  const style = MARK_STYLE[value] ?? MARK_STYLE['']
  return (
    <span
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-bold ring-1 ring-inset ${style}`}
    >
      {value || '\u00b7'}
    </span>
  )
}
