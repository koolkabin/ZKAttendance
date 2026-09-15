/**
 * NepaliDatePicker
 *
 * One picker for both calendar systems. The value on the wire is always an AD
 * ISO string (yyyy-mm-dd) — what changes is only how it is drawn and typed.
 * The button face is always dd/mm/yyyy so it matches every other date on screen.
 *
 * Props
 *   value          string   AD ISO 'yyyy-mm-dd'
 *   onChange       (isoAd: string) => void
 *   disableFuture  boolean  default true — future days are greyed out
 *   max / min      string   explicit AD ISO bounds (override disableFuture)
 *   clearable      boolean  show a "Clear" action
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { MdCalendarMonth } from 'react-icons/md'
import { useCalendar } from '../context/CalendarContext'
import { adToBs, bsToAdIso } from '../lib/nepaliCalendar'
import { dmy, todayIso } from '../lib/dates'
import NepaliMonthCalendar from './NepaliMonthCalendar'

// Re-exported because a few report screens import it from here.
export { bsToAdIso }

/** Which month the popover should open on, given an AD ISO date. */
function viewFor(iso, isBs) {
  if (isBs) {
    const bs = adToBs(iso)
    return bs ? { year: bs.year, month: bs.month } : { year: 2080, month: 1 }
  }
  const [y, m] = String(iso).slice(0, 10).split('-').map(Number)
  return { year: y, month: m }
}

export default function NepaliDatePicker({
  value,
  onChange,
  disableFuture = true,
  max,
  min,
  clearable = false,
  placeholder = 'Select date',
  className = '',
  disabled = false,
}) {
  const { isBs, formatDate } = useCalendar()
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState({ v: 'down', h: 'left' })
  const wrapRef = useRef(null)

  const today = useMemo(() => todayIso(), [])
  const maxIso = max ?? (disableFuture ? today : undefined)

  // The month the popover is showing, in the ACTIVE calendar system.
  const [view, setView] = useState(() => viewFor(value || today, isBs))

  // Follow the selected value, and re-base when the user flips BS ⇄ AD.
  useEffect(() => {
    setView(viewFor(value || today, isBs))
  }, [value, isBs, today])

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Flip the popover up / left when it would run off the viewport.
  useEffect(() => {
    if (!open || !wrapRef.current) return
    function check() {
      if (!wrapRef.current) return
      const rect = wrapRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const pickerHeight = 330
      const v = spaceBelow < pickerHeight && spaceAbove > spaceBelow ? 'up' : 'down'
      const h = rect.left + 300 > window.innerWidth && rect.right >= 290 ? 'right' : 'left'
      setPlacement({ v, h })
    }
    check()
    window.addEventListener('scroll', check, true)
    window.addEventListener('resize', check)
    return () => {
      window.removeEventListener('scroll', check, true)
      window.removeEventListener('resize', check)
    }
  }, [open])

  const face = value ? formatDate(value) : placeholder

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="input flex w-full cursor-pointer items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={value ? 'font-medium text-slate-800' : 'text-sm text-slate-400'}>{face}</span>
        <MdCalendarMonth className="ml-2 h-4.5 w-4.5 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          className={`absolute z-50 w-[19rem] max-w-[calc(100vw-2rem)] ${
            placement.v === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } ${placement.h === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="rounded-xl shadow-xl ring-1 ring-slate-900/10">
            <NepaliMonthCalendar
              compact
              view={view}
              onViewChange={setView}
              selectedIso={value || undefined}
              maxIso={maxIso}
              minIso={min}
              disableFuture={disableFuture}
              onDayClick={(cell) => {
                onChange(cell.adIso)
                setOpen(false)
              }}
              footer={
                <div className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (maxIso && today > maxIso) return
                      onChange(today)
                      setOpen(false)
                    }}
                    className="font-medium text-sky-600 hover:underline"
                  >
                    Today · {formatDate(today)}
                  </button>
                  <div className="flex items-center gap-3">
                    {clearable && value && (
                      <button
                        type="button"
                        onClick={() => {
                          onChange('')
                          setOpen(false)
                        }}
                        className="font-medium text-slate-500 hover:text-rose-600"
                      >
                        Clear
                      </button>
                    )}
                    <span className="text-slate-400">{isBs ? 'BS' : 'AD'}</span>
                  </div>
                </div>
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
