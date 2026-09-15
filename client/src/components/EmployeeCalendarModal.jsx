import { useEffect, useMemo, useState, useRef } from 'react'
import { overview } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { hm, hoursText, todayIso } from '../lib/dates'
import { adToBs, buildMonthGrid } from '../lib/nepaliCalendar'
import { useCalendar } from '../context/CalendarContext'
import { Modal } from './ui'
import NepaliMonthCalendar from './NepaliMonthCalendar'
import DayDetailModal from './DayDetailModal'
import StatusMark, { normaliseStatus, statusMeta } from './attendance/StatusMark'

/**
 * One employee's month, drawn as a wall calendar.
 *
 * The month is chosen in whichever system the user is in — a BS month runs
 * from Baisakh 1 to the last of Baisakh, not from the 1st of an English month —
 * and the AD range it covers is derived from the grid, so the API is always
 * asked for exactly the days shown.
 */
export default function EmployeeCalendarModal({ employeeId, employeeName, onClose }) {
  const { isBs } = useCalendar()

  const [view, setView] = useState(() => {
    const bs = adToBs(new Date())
    const d = new Date()
    return isBs ? { year: bs.year, month: bs.month } : { year: d.getFullYear(), month: d.getMonth() + 1 }
  })

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)

  const today = useMemo(() => todayIso(), [])

  // Re-base the month only when the user actually TOGGLES AD/BS.
  //
  // This effect converts the view from the old system into the new one. On the
  // first render no toggle happened, so running it treated a date that was
  // already correct as if it were in the other calendar. That pushed the year
  // to 2140 BS and rendered a nonsense AD year, which is why every calendar
  // opened on the wrong decade.
  const didMount = useRef(false)

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true
      return
    }

    setView((v) => {
      const grid = buildMonthGrid(isBs ? 'AD' : 'BS', v.year, v.month)
      const anchor = grid.cells.find(Boolean)
      if (!anchor) return v
      return isBs
        ? { year: anchor.bsYear, month: anchor.bsMonth }
        : { year: anchor.adYear, month: anchor.adMonth }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBs])

  // The AD span the visible month covers.
  const span = useMemo(() => {
    const grid = buildMonthGrid(isBs ? 'BS' : 'AD', view.year, view.month)
    const real = grid.cells.filter(Boolean)
    return { from: real[0]?.adIso, to: real[real.length - 1]?.adIso }
  }, [isBs, view])

  useEffect(() => {
    if (!span.from || !span.to) return
    setLoading(true)
    setError('')
    setData(null)
    overview
      .get({ from: span.from, to: span.to, employeeId })
      .then(setData)
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [span.from, span.to, employeeId])

  const emp = data?.departments?.[0]?.employees?.[0]
  const cellByIso = emp?.cells || {}

  const dayMeta = useMemo(() => {
    const m = {}
    for (const d of data?.days || []) m[d.dateIso] = d
    return m
  }, [data])

  /** Days actually worked, and what they averaged. */
  const stats = useMemo(() => {
    const worked = Object.entries(cellByIso)
      .filter(([, c]) => c && (c.status === 'Present' || c.status === 'Half Day') && c.hours > 0)
      .map(([, c]) => c.hours)
    const total = worked.reduce((a, b) => a + b, 0)
    return {
      present: emp?.presentDays ?? 0,
      absent: emp?.absentDays ?? 0,
      workingDays: emp?.totalDays ?? 0,
      totalHours: total,
      avgHours: worked.length ? total / worked.length : 0,
      daysCounted: worked.length,
    }
  }, [cellByIso, emp])

  return (
    <Modal
      title={
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-slate-900 sm:text-lg">{employeeName}</div>
          <div className="mt-0.5 text-xs font-normal text-slate-500">Attendance calendar</div>
        </div>
      }
      onClose={onClose}
      wide
    >
      {/* Month summary strip */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Present" value={stats.present} tone="emerald" />
        <Stat label="Absent" value={stats.absent} tone="rose" />
        <Stat label="Working days" value={stats.workingDays} />
        <Stat
          label="Avg. hours / day"
          value={stats.avgHours > 0 ? hoursText(stats.avgHours) : '—'}
          hint={stats.daysCounted > 0 ? `over ${stats.daysCounted} day${stats.daysCounted > 1 ? 's' : ''}` : undefined}
          tone="sky"
        />
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="mb-3 text-sm text-slate-500">Loading...</p>}

      <NepaliMonthCalendar
        view={view}
        onViewChange={setView}
        disableFuture={true}
        onDayClick={(cell) => {
          const c = cellByIso[cell.adIso]
          const status = normaliseStatus(c?.status)
          if (status === 'Upcoming' || status === 'Not Joined') return
          setDetail({ date: cell.adIso, dateBs: dayMeta[cell.adIso]?.dateBs || cell.bsIso })
        }}
        dayRender={(cell) => {
          const c = cellByIso[cell.adIso]
          const meta = dayMeta[cell.adIso]

          // A day that has not happened yet is never absent — the server sends
          // "Upcoming" for it, and anything past the end of the loaded range
          // has no cell at all.
          if (!c) {
            return {
              disabled: true,
              title: cell.adIso > today ? 'Not due yet' : 'Outside the loaded range',
            }
          }

          const weeklyOff =
            meta?.holidayName === 'Weekly off' || meta?.holidayType === 'Weekly off'
          const status = weeklyOff && c.status === 'Holiday' ? 'Day Off' : normaliseStatus(c.status)
          const tone = statusMeta(status)

          const holidayLabel =
            status === 'Holiday' ? meta?.holidayName : status === 'Day Off' ? 'Weekly off' : null

          return {
            disabled: status === 'Upcoming' || status === 'Not Joined',
            tone:
              status === 'Present' ? 'bg-emerald-50/60'
                : status === 'Absent' ? 'bg-rose-50/60'
                  : status === 'Holiday' ? 'bg-violet-50/60'
                    : status === 'Half Day' ? 'bg-amber-50/60'
                      : '',
            dayClass: cell.isSaturday ? 'text-rose-500' : undefined,
            title: holidayLabel ? `${tone.label}: ${holidayLabel}` : tone.label,
            top: <StatusMark status={status} />,
            bottom:
              c.firstIn ? (
                <span className="text-[9px] leading-tight text-slate-500 tabular-nums">
                  {hm(c.firstIn)}
                  {c.lastOut ? `–${hm(c.lastOut)}` : ''}
                </span>
              ) : holidayLabel ? (
                <span className="text-[9px] leading-tight text-violet-600">{holidayLabel}</span>
              ) : null,
          }
        }}
      />

      <p className="mt-3 text-xs text-slate-400">
        Click any day to see all scans.
      </p>

      {detail && (
        <DayDetailModal
          employeeId={employeeId}
          employeeName={employeeName}
          date={detail.date}
          dateBs={detail.dateBs}
          onClose={() => setDetail(null)}
        />
      )}
    </Modal>
  )
}

function Stat({ label, value, hint, tone = 'slate' }) {
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
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  )
}
