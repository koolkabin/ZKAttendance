import { useEffect, useMemo, useState, useRef } from 'react'
import { holidays as api } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { ymd, dmy, bsDmy, todayIso } from '../lib/dates'
import { adToBs, buildMonthGrid } from '../lib/nepaliCalendar'
import { PageHeader, Card, ErrorText, Button, Field, Input, Select, Badge } from '../components/ui'
import { useFeedback } from '../components/feedback'
import { useCalendar } from '../context/CalendarContext'
import DateToggle from '../components/DateToggle'
import NepaliDatePicker from '../components/NepaliDatePicker'
import NepaliMonthCalendar from '../components/NepaliMonthCalendar'
import { HiOutlineCalendarDays, HiOutlineCalendarDateRange } from 'react-icons/hi2'

const TYPES = ['Festival', 'Religious', 'National', 'Public', 'Bandh / strike', 'Company', 'Other']

const emptyForm = { date: '', toDate: '', holidayName: '', holidayType: 'Festival', description: '', isRange: false }

/**
 * Holidays, laid out as calendar on the left and entry form on the right.
 * Supports single day marking or date ranges for multi-day festivals like Dashain and Tihar.
 */
export default function Holidays() {
  const fb = useFeedback()
  const { isBs, formatDate } = useCalendar()
  const today = useMemo(() => todayIso(), [])

  function getCurrentView(isBsMode) {
    const d = new Date()
    if (isBsMode) {
      const bs = adToBs(d)
      return { year: bs?.year || 2083, month: bs?.month || 5 }
    }
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }

  const [view, setView] = useState(() => getCurrentView(isBs))

  const [holidays, setHolidays] = useState([])
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => ({ ...emptyForm, date: todayIso() }))
  const [editingExisting, setEditingExisting] = useState(false)
  const [saving, setSaving] = useState(false)

  function goToToday() {
    setView(getCurrentView(isBs))
    selectDay(today)
  }

  // Ensure view syncs with current date whenever calendar mode (BS/AD) toggles
  useEffect(() => {
    setView(getCurrentView(isBs))
    selectDay(today)
  }, [isBs])

  // The AD span the visible month covers
  const span = useMemo(() => {
    const grid = buildMonthGrid(isBs ? 'BS' : 'AD', view.year, view.month)
    const real = grid.cells.filter(Boolean)
    return { from: real[0]?.adIso, to: real[real.length - 1]?.adIso }
  }, [isBs, view])

  function load() {
    if (!span.from || !span.to) return
    setError('')
    api
      .list({ from: span.from, to: span.to })
      .then(setHolidays)
      .catch((e) => setError(apiErrorMessage(e)))
  }

  useEffect(load, [span.from, span.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const holidayByDate = useMemo(() => {
    const map = {}
    for (const h of holidays) map[ymd(h.date)] = h
    return map
  }, [holidays])

  // Calculate range days count
  const rangeDuration = useMemo(() => {
    if (!form.isRange || !form.date || !form.toDate) return 1
    const d1 = new Date(form.date)
    const d2 = new Date(form.toDate)
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1
    return diff > 0 ? diff : 1
  }, [form.isRange, form.date, form.toDate])

  // Sync form when holidays load or if date matches an existing holiday
  useEffect(() => {
    if (!form.date || form.isRange) return
    const existing = holidayByDate[form.date]
    if (existing && !editingExisting) {
      setEditingExisting(true)
      setForm((prev) => ({
        ...prev,
        holidayName: existing.holidayName,
        holidayType: existing.holidayType || 'Festival',
        description: existing.description || '',
      }))
    }
  }, [holidayByDate, form.date, form.isRange, editingExisting])

  function selectDay(iso) {
    const existing = holidayByDate[iso]
    setEditingExisting(Boolean(existing))
    setForm(
      existing
        ? {
            ...emptyForm,
            date: iso,
            toDate: '',
            isRange: false,
            holidayName: existing.holidayName,
            holidayType: existing.holidayType || 'Festival',
            description: existing.description || '',
          }
        : { ...emptyForm, date: iso, toDate: '', isRange: false },
    )
  }

  async function save(e) {
    e.preventDefault()
    if (!form.date) {
      fb.error('Pick a date first.')
      return
    }
    if (form.isRange && form.toDate && form.toDate < form.date) {
      fb.error('To Date cannot be earlier than From Date.')
      return
    }
    setSaving(true)
    try {
      await api.create({
        date: form.date,
        toDate: form.isRange && form.toDate ? form.toDate : undefined,
        holidayName: form.holidayName.trim(),
        holidayType: form.holidayType,
        description: form.description.trim() || null,
      })
      fb.success(
        editingExisting
          ? 'Holiday updated'
          : form.isRange && form.toDate
          ? `Holidays added for ${rangeDuration} days`
          : 'Holiday added',
      )
      setForm({ ...emptyForm, date: todayIso() })
      setEditingExisting(false)
      load()
    } catch (err) {
      fb.error(apiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove(iso) {
    const ok = await fb.confirm({
      title: 'Remove holiday',
      message: `Unmark ${formatDate(iso)} as a holiday?`,
      confirmText: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await api.removeOnDate(iso)
      fb.success('Holiday removed')
      if (form.date === iso) {
        selectDay(today)
      }
      load()
    } catch (err) {
      fb.error(apiErrorMessage(err))
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Holidays" actions={<DateToggle />} />
      {error && <ErrorText>{error}</ErrorText>}

      {/* Grid container: Calendar on left, Entry on right */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
        {/* ── Left: Calendar & compact list ────────────────────────── */}
        <div>
          <NepaliMonthCalendar
            view={view}
            onViewChange={setView}
            selectedIso={form.date || today}
            onDayClick={(cell) => {
              if (cell.isSaturday) {
                fb.info('Saturday is already the weekly off.')
                return
              }
              selectDay(cell.adIso)
            }}
            dayRender={(cell) => {
              const h = holidayByDate[cell.adIso]
              if (cell.isSaturday) {
                return {
                  tone: 'bg-slate-50',
                  dayClass: 'text-rose-400',
                  title: 'Weekly off',
                  bottom: <span className="text-[9px] leading-tight text-slate-400">weekly off</span>,
                }
              }
              if (h) {
                return {
                  tone: 'bg-violet-50/70',
                  dayClass: 'text-violet-700',
                  title: `${h.holidayName}${h.holidayType ? ` (${h.holidayType})` : ''}`,
                  bottom: (
                    <span className="text-[9px] font-medium leading-tight text-violet-700 truncate block">
                      {h.holidayName}
                    </span>
                  ),
                }
              }
              return {}
            }}
            footer={
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <div className="flex items-center gap-1.5 font-medium">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-600"></span>
                  <span>Today: <strong className="text-slate-800">{formatDate(today)}</strong></span>
                </div>
                <button
                  type="button"
                  onClick={goToToday}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-sky-700 shadow-xs hover:bg-sky-50 transition cursor-pointer"
                >
                  Today
                </button>
              </div>
            }
          />

          {/* Compact monthly list underneath */}
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 text-xs font-bold text-slate-700">
              <span>Holidays this month</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.2 text-[11px] font-semibold text-slate-600">
                {holidays.length}
              </span>
            </div>
            <div className="max-h-32 overflow-y-auto divide-y divide-slate-100 mt-1">
              {holidays.length === 0 ? (
                <p className="py-2.5 text-center text-xs text-slate-400">
                  No holidays marked this month.
                </p>
              ) : (
                holidays.map((h) => {
                  const iso = ymd(h.date)
                  const bs = adToBs(h.date)
                  return (
                    <div key={h.holidayId} className="flex items-center justify-between py-1.5 text-xs">
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800 truncate">{h.holidayName}</span>
                          {h.holidayType && <Badge tone="sky">{h.holidayType}</Badge>}
                        </div>
                        <div className="text-[11px] text-slate-400 tabular-nums">
                          {isBs ? `${bsDmy(bs?.dateBs)} BS · ${dmy(h.date)} AD` : `${dmy(h.date)} AD · ${bsDmy(bs?.dateBs)} BS`}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2 text-xs">
                        <button onClick={() => selectDay(iso)} className="text-sky-600 hover:underline">edit</button>
                        <button onClick={() => remove(iso)} className="text-rose-600 hover:underline">remove</button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Entry Form ────────────────────────────────────── */}
        <div>
          <Card className="p-4 sm:p-4.5 shadow-sm">
            {/* Prominent High-Contrast Mode Switcher */}
            {!editingExisting && (
              <div className="grid grid-cols-2 gap-2 mb-3.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, isRange: false, toDate: '' }))}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    !form.isRange
                      ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md ring-2 ring-sky-300'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <HiOutlineCalendarDays className="h-4 w-4 shrink-0" />
                  <span>Single Day</span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, isRange: true, toDate: p.toDate || p.date }))}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    form.isRange
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md ring-2 ring-indigo-300'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <HiOutlineCalendarDateRange className="h-4 w-4 shrink-0" />
                  <span>Multiple Days (Range)</span>
                </button>
              </div>
            )}

            {editingExisting && (
              <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-800">Edit Holiday</h2>
                <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  Editing Mode
                </span>
              </div>
            )}

            <form onSubmit={save} className="space-y-3">
              {/* Date pickers */}
              {!form.isRange ? (
                <Field
                  label={
                    <span className="flex items-center justify-between">
                      <span>Date ({isBs ? 'BS' : 'AD'})</span>
                      {form.date !== today && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            goToToday()
                          }}
                          className="text-xs font-semibold text-sky-600 hover:text-sky-700 hover:underline cursor-pointer"
                        >
                          Today
                        </button>
                      )}
                    </span>
                  }
                  required
                >
                  <NepaliDatePicker
                    value={form.date}
                    onChange={(date) => selectDay(date || today)}
                    disableFuture={false}
                    clearable
                    placeholder="Choose a date"
                  />
                </Field>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label={`From Date (${isBs ? 'BS' : 'AD'})`} required>
                    <NepaliDatePicker
                      value={form.date}
                      onChange={(date) => setForm((p) => ({ ...p, date: date || today }))}
                      disableFuture={false}
                      clearable
                      placeholder="Start date"
                    />
                  </Field>
                  <Field label={`To Date (${isBs ? 'BS' : 'AD'})`} required>
                    <NepaliDatePicker
                      value={form.toDate || form.date}
                      onChange={(date) => setForm((p) => ({ ...p, toDate: date || form.date }))}
                      disableFuture={false}
                      clearable
                      placeholder="End date"
                    />
                  </Field>
                </div>
              )}

              {/* Compact date info banner */}
              {form.date && (
                <div className="flex items-center justify-between rounded-lg bg-sky-50/70 border border-sky-100 px-3 py-1.5 text-xs text-sky-950 font-medium">
                  <span className="tabular-nums">
                    {isBs
                      ? `${bsDmy(adToBs(form.date)?.dateBs)} BS`
                      : `${dmy(form.date)} AD`}
                    {form.isRange && form.toDate && form.toDate !== form.date && (
                      <>
                        {' → '}
                        {isBs
                          ? `${bsDmy(adToBs(form.toDate)?.dateBs)} BS`
                          : `${dmy(form.toDate)} AD`}
                      </>
                    )}
                  </span>
                  {form.isRange && form.toDate && (
                    <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                      {rangeDuration} {rangeDuration === 1 ? 'day' : 'days'}
                    </span>
                  )}
                </div>
              )}

              <Field label="Holiday Name" required>
                <Input
                  value={form.holidayName}
                  onChange={(e) => setForm({ ...form, holidayName: e.target.value })}
                  required
                  placeholder="e.g. Dashain Vacation"
                />
              </Field>

              {/* Type and Note side-by-side to save vertical space */}
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Category">
                  <Select
                    value={form.holidayType}
                    onChange={(e) => setForm({ ...form, holidayType: e.target.value })}
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Note">
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Optional note"
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span>
                  {editingExisting && (
                    <Button type="button" variant="danger" onClick={() => remove(form.date)}>
                      Remove
                    </Button>
                  )}
                </span>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      selectDay(today)
                    }}
                  >
                    Reset
                  </Button>
                  <Button type="submit" disabled={saving || !form.date}>
                    {saving
                      ? 'Saving…'
                      : editingExisting
                      ? 'Update'
                      : form.isRange
                      ? `Add ${rangeDuration} Days`
                      : 'Add Holiday'}
                  </Button>
                </span>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}

