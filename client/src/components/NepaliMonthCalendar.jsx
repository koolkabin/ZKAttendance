import { useEffect, useMemo } from 'react'
import { useCalendar } from '../context/CalendarContext'
import {
  buildMonthGrid,
  shiftMonth,
  toNepaliDigits,
  adToBs,
  MONTH_NAMES_EN,
  MONTH_NAMES_NP,
  AD_MONTH_NAMES_EN,
  DAY_SHORT_EN,
  DAY_SHORT_NP,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
} from '../lib/nepaliCalendar'

/**
 * A month calendar laid out the way a Nepali wall patro is: the active system's
 * day large, the other system's day small in the corner, Saturday in red, and
 * the festival / holiday name printed under the number.
 *
 * It is deliberately dumb about *meaning*. Callers pass `dayRender` to decide
 * what a given day looks like, which is why the same component serves the
 * holiday editor and the per-employee attendance calendar.
 *
 * Props
 *   view        { year, month }  in the ACTIVE calendar system
 *   onViewChange(next)           called with the new { year, month }
 *   dayRender(cell)              → { tone, top, bottom, disabled, title }
 *   onDayClick(cell)
 *   selectedIso                  AD ISO string of the selected day
 *   maxIso / minIso              AD ISO bounds; days outside are disabled
 *   compact                      smaller cells, for the date-picker popover
 *   disableFuture                disallow viewing / advancing into future months
 */
export default function NepaliMonthCalendar({
  view,
  onViewChange,
  dayRender,
  onDayClick,
  selectedIso,
  maxIso,
  minIso,
  compact = false,
  disableFuture = false,
  footer,
}) {
  const { isBs } = useCalendar()

  const currentView = useMemo(() => {
    const d = new Date()
    if (isBs) {
      const bs = adToBs(d)
      return { year: bs?.year || 2083, month: bs?.month || 5 }
    }
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }, [isBs])

  const isAtOrPastCurrent = disableFuture && (
    view.year > currentView.year || (view.year === currentView.year && view.month >= currentView.month)
  )

  useEffect(() => {
    if (!disableFuture) return
    if (view.year > currentView.year) {
      onViewChange({ ...view, year: currentView.year, month: currentView.month })
    } else if (view.year === currentView.year && view.month > currentView.month) {
      onViewChange({ ...view, month: currentView.month })
    }
  }, [disableFuture, view, currentView, onViewChange])

  const grid = useMemo(
    () => buildMonthGrid(isBs ? 'BS' : 'AD', view.year, view.month),
    [isBs, view.year, view.month],
  )

  const todayIso = useMemo(() => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }, [])

  const years = useMemo(() => {
    const list = []
    if (isBs) {
      const maxYear = disableFuture ? currentView.year : MAX_BS_YEAR
      for (let y = MIN_BS_YEAR; y <= maxYear; y++) list.push(y)
    } else {
      const now = new Date().getFullYear()
      const maxYear = disableFuture ? now : now + 10
      for (let y = now - 10; y <= maxYear; y++) list.push(y)
    }
    return list
  }, [isBs, disableFuture, currentView.year])

  const monthNames = isBs ? MONTH_NAMES_EN : AD_MONTH_NAMES_EN
  const weekdayNames = isBs ? DAY_SHORT_NP : DAY_SHORT_EN

  const step = (delta) => {
    if (delta > 0 && isAtOrPastCurrent) return
    onViewChange(shiftMonth(isBs ? 'BS' : 'AD', view.year, view.month, delta))
  }

  const cellHeight = compact ? 'h-10' : 'h-20 sm:h-24'

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* ── Month header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 bg-slate-900 px-3 py-2.5 text-white sm:px-4">
        <button
          type="button"
          onClick={() => step(-1)}
          className="rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white cursor-pointer"
          aria-label="Previous month"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        <div className="min-w-0 text-center">
          <div className={`truncate font-semibold tracking-tight ${compact ? 'text-sm' : 'text-base sm:text-lg'}`}>
            {grid.titlePrimary}
          </div>
          <div className="truncate text-[10px] text-slate-400 sm:text-xs">
            {grid.titleSecondary} · {grid.spanLabel}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {!compact && (
            <button
              type="button"
              onClick={() => {
                onViewChange(currentView)
                const d = new Date()
                onDayClick?.({ adIso: todayIso, isSaturday: d.getDay() === 6 })
              }}
              className="inline-flex items-center rounded border border-white/20 bg-white/10 px-2 py-0.5 text-xs font-semibold text-white hover:bg-white/20 transition cursor-pointer"
              title="Jump to Today"
            >
              Today
            </button>
          )}
          {!compact && (
            <div className="hidden items-center gap-1.5 sm:flex">
              <select
                value={view.month}
                onChange={(e) => onViewChange({ ...view, month: Number(e.target.value) })}
                className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 text-xs font-medium text-white outline-none"
              >
                {monthNames.map((name, i) => {
                  const m = i + 1
                  if (disableFuture && view.year === currentView.year && m > currentView.month) {
                    return null
                  }
                  return (
                    <option key={name} value={m} className="text-slate-800">
                      {isBs ? `${MONTH_NAMES_NP[i]} · ${name}` : name}
                    </option>
                  )
                })}
              </select>
              <select
                value={view.year}
                onChange={(e) => onViewChange({ ...view, year: Number(e.target.value) })}
                className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 text-xs font-medium text-white outline-none"
              >
                {years.map((y) => (
                  <option key={y} value={y} className="text-slate-800">
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={() => step(1)}
            disabled={isAtOrPastCurrent}
            className={`rounded-lg p-1.5 transition ${
              isAtOrPastCurrent
                ? 'opacity-30 cursor-not-allowed text-slate-500'
                : 'text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer'
            }`}
            aria-label="Next month"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Weekday strip ────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {weekdayNames.map((w, i) => (
          <div
            key={w}
            className={`py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide sm:text-xs ${
              i === 6 ? 'text-rose-500' : 'text-slate-500'
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* ── Days ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7">
        {grid.cells.map((cell, i) => {
          if (!cell) {
            return <div key={`blank-${i}`} className={`${cellHeight} border-b border-r border-slate-100 bg-slate-50/40 last:border-r-0`} />
          }

          const meta = dayRender ? dayRender(cell) || {} : {}
          const outOfRange =
            (maxIso && cell.adIso > maxIso) || (minIso && cell.adIso < minIso)
          const disabled = meta.disabled || outOfRange
          const isToday = cell.adIso === todayIso
          const isSelected = selectedIso && cell.adIso === selectedIso

          return (
            <button
              key={cell.adIso}
              type="button"
              disabled={disabled || !onDayClick}
              title={meta.title || ''}
              onClick={() => !disabled && onDayClick?.(cell)}
              className={[
                cellHeight,
                'relative flex flex-col items-center justify-start gap-0.5 border-b border-r border-slate-100 px-1 pt-1.5 text-left transition last:border-r-0',
                disabled ? 'cursor-not-allowed bg-slate-50/60 opacity-45' : '',
                !disabled && onDayClick ? 'cursor-pointer hover:bg-sky-50/70' : '',
                isSelected ? 'bg-sky-600/10 ring-2 ring-inset ring-sky-500' : '',
                meta.tone || '',
              ].join(' ')}
            >
              {/* Small date in the OTHER calendar system, corner-set */}
              <span className="absolute right-1 top-1 text-[9px] font-medium leading-none text-slate-400 sm:text-[10px]">
                {cell.secondaryDay}
              </span>

              {/* The big number */}
              <span
                className={[
                  compact ? 'text-xs' : 'text-base sm:text-lg',
                  'font-semibold leading-none',
                  isToday ? 'flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-white sm:h-7 sm:w-7' : '',
                  !isToday && meta.dayClass ? meta.dayClass : '',
                  !isToday && !meta.dayClass && cell.isSaturday ? 'text-rose-500' : '',
                  !isToday && !meta.dayClass && !cell.isSaturday ? 'text-slate-800' : '',
                ].join(' ')}
              >
                {isBs ? toNepaliDigits(cell.primaryDay) : cell.primaryDay}
              </span>

              {!compact && meta.top && <span className="w-full truncate text-center">{meta.top}</span>}
              {!compact && meta.bottom && <span className="w-full truncate text-center">{meta.bottom}</span>}
            </button>
          )
        })}
      </div>

      {footer && <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2">{footer}</div>}
    </div>
  )
}
