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

const TYPES = ['Festival', 'Religious', 'National', 'Public', 'Bandh / strike', 'Company', 'Other']

const emptyForm = { date: '', holidayName: '', holidayType: 'Festival', description: '' }

/**
 * Holidays, laid out as calendar on the left and entry form on the right.
 *
 * The old screen only let a holiday be added by clicking a day, which meant
 * paging to the right month first and gave nowhere to type a date directly.
 * Now both work: click a day to load it into the form, or pick the date in the
 * form itself. The form scrolls independently and sticks, so a long festival
 * list on the left never pushes the Save button off screen.
 */
export default function Holidays() {
  const fb = useFeedback()
  const { isBs, formatDate } = useCalendar()
  const today = useMemo(() => todayIso(), [])

  const [view, setView] = useState(() => {
    const d = new Date()
    const bs = adToBs(d)
    return isBs ? { year: bs.year, month: bs.month } : { year: d.getFullYear(), month: d.getMonth() + 1 }
  })

  const [holidays, setHolidays] = useState([])
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => ({ ...emptyForm, date: todayIso() }))
  const [editingExisting, setEditingExisting] = useState(false)
  const [saving, setSaving] = useState(false)

  function goToToday() {
    const d = new Date()
    const bs = adToBs(d)
    setView(isBs ? { year: bs.year, month: bs.month } : { year: d.getFullYear(), month: d.getMonth() + 1 })
    selectDay(today)
  }

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

  // The AD span the visible month covers — a BS month straddles two AD months,
  // so the range has to come from the grid rather than from month arithmetic.
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

  // Sync form when holidays load or if date matches an existing holiday
  useEffect(() => {
    if (!form.date) return
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
  }, [holidayByDate, form.date, editingExisting])

  function selectDay(iso) {
    const existing = holidayByDate[iso]
    setEditingExisting(Boolean(existing))
    setForm(
      existing
        ? {
            date: iso,
            holidayName: existing.holidayName,
            holidayType: existing.holidayType || 'Festival',
            description: existing.description || '',
          }
        : { ...emptyForm, date: iso },
    )
  }

  async function save(e) {
    e.preventDefault()
    if (!form.date) {
      fb.error('Pick a date first.')
      return
    }
    setSaving(true)
    try {
      await api.create({
        date: form.date,
        holidayName: form.holidayName.trim(),
        holidayType: form.holidayType,
        description: form.description.trim() || null,
      })
      fb.success(editingExisting ? 'Holiday updated' : 'Holiday added')
      setForm(emptyForm)
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
    <div>
      <PageHeader
        title="Holidays"
        subtitle="Click a day or pick a date to mark a holiday"
        actions={<DateToggle />}
      />
      {error && <ErrorText>{error}</ErrorText>}

      {/* Half calendar, half entry — each scrolls on its own so a long
          festival list never pushes Save out of reach. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Left: the month ─────────────────────────────────────── */}
        <div>
          <NepaliMonthCalendar
            view={view}
            onViewChange={setView}
            selectedIso={form.date || today}
            onDayClick={(cell) => {
              if (cell.isSaturday) {
                fb.info('Saturday is already the fixed weekly off — no holiday needed.')
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
                    <span className="text-[9px] font-medium leading-tight text-violet-700">
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
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-700 shadow-sm hover:bg-sky-50 transition cursor-pointer"
                >
                  Jump to Today
                </button>
              </div>
            }
          />

          {/* This month's list, scrollable */}
          <Card className="mt-4">
            <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
              Holidays this month
              <span className="ml-2 text-xs font-normal text-slate-400">({holidays.length})</span>
            </div>
            <div className="max-h-64 overflow-y-auto overscroll-contain">
              {holidays.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">
                  Nothing marked in this month.
                </p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {holidays.map((h) => {
                    const iso = ymd(h.date)
                    const bs = adToBs(h.date)
                    return (
                      <li key={h.holidayId} className="flex items-start justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-900">{h.holidayName}</span>
                            {h.holidayType && <Badge tone="sky">{h.holidayType}</Badge>}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                            {isBs
                              ? `${bsDmy(bs?.dateBs)} BS · ${dmy(h.date)} AD`
                              : `${dmy(h.date)} AD · ${bsDmy(bs?.dateBs)} BS`}
                          </div>
                          {h.description && (
                            <div className="mt-0.5 text-xs text-slate-400">{h.description}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-3 text-xs">
                          <button onClick={() => selectDay(iso)} className="text-sky-600 hover:underline">
                            edit
                          </button>
                          <button onClick={() => remove(iso)} className="text-red-600 hover:underline">
                            remove
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {/* ── Right: add / edit ───────────────────────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="p-4 sm:p-5">
            <h2 className="text-base font-semibold text-slate-900">
              {editingExisting ? 'Edit holiday' : 'Add a holiday'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {editingExisting
                ? 'This will overwrite the existing entry.'
                : 'Past and future dates are both allowed.'}
            </p>

            <form onSubmit={save} className="mt-4 space-y-4">
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
                        Set to Today
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

              {form.date && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                  <div className="tabular-nums">
                    {isBs
                      ? `${bsDmy(adToBs(form.date)?.dateBs)} BS · ${dmy(form.date)} AD`
                      : `${dmy(form.date)} AD · ${bsDmy(adToBs(form.date)?.dateBs)} BS`}
                    {form.date < today && <span className="ml-2 text-slate-400">(past date)</span>}
                    {form.date > today && <span className="ml-2 text-sky-600">(upcoming)</span>}
                  </div>
                </div>
              )}

              <Field label="Name" required hint="e.g. Dashain, Tihar, Teej">
                <Input
                  value={form.holidayName}
                  onChange={(e) => setForm({ ...form, holidayName: e.target.value })}
                  required
                  placeholder="Holiday name"
                />
              </Field>

              <Field label="Type">
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

              <Field label="Note" hint="Optional">
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. Women's festival, government holiday"
                />
              </Field>

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
                    Reset to Today
                  </Button>
                  <Button type="submit" disabled={saving || !form.date}>
                    {saving ? 'Saving…' : editingExisting ? 'Update' : 'Add holiday'}
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
