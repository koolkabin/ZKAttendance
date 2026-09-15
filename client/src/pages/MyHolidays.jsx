import { useEffect, useState } from 'react'
import { attendance as attendanceApi } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { dmy } from '../lib/dates'
import { PageHeader } from '../components/ui'
import {
  HiOutlineCalendarDays,
  HiOutlineGift,
  HiOutlineStar,
  HiOutlineBuildingLibrary,
} from 'react-icons/hi2'

// Holiday type → icon + color
function HolidayBadge({ type }) {
  const cfg = {
    Public: { icon: HiOutlineGift, cls: 'bg-violet-100 text-violet-700 border-violet-200' },
    Government: { icon: HiOutlineBuildingLibrary, cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    Religious: { icon: HiOutlineStar, cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    Office: { icon: HiOutlineCalendarDays, cls: 'bg-sky-100 text-sky-700 border-sky-200' },
  }
  const { icon: Icon, cls } = cfg[type] ?? { icon: HiOutlineCalendarDays, cls: 'bg-slate-100 text-slate-600 border-slate-200' }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      <Icon className="h-3 w-3" />
      {type}
    </span>
  )
}

function HolidayCard({ holiday }) {
  const date = new Date(holiday.date)
  const dayName = date.toLocaleDateString('en', { weekday: 'long' })
  const displayDate = dmy(holiday.date)

  const isToday = holiday.daysUntil === 0
  const upcoming = !holiday.isPast && holiday.daysUntil > 0

  return (
    <div
      className={`flex items-start gap-4 rounded-xl border px-5 py-4 transition ${
        isToday
          ? 'border-violet-300 bg-violet-50 shadow-sm'
          : holiday.isPast
          ? 'border-slate-200 bg-slate-50 opacity-65'
          : 'border-slate-200 bg-white hover:border-sky-200 hover:shadow-sm'
      }`}
    >
      {/* Date block */}
      <div className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border py-2 shadow-xs ${
        isToday ? 'border-violet-300 bg-violet-600 text-white' : 'border-slate-200 bg-white text-slate-800'
      }`}>
        <span className="text-xl font-bold leading-none">{date.toLocaleDateString('en', { day: '2-digit' })}</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase opacity-70">
          {date.toLocaleDateString('en', { month: 'short' })}
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-800">{holiday.holidayName}</p>
          {isToday && (
            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">
              Today
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {dayName}, {displayDate}
          {holiday.description ? ` · ${holiday.description}` : ''}
        </p>
        {upcoming && (
          <p className="mt-1 text-xs text-sky-600 font-medium">
            In {holiday.daysUntil} day{holiday.daysUntil !== 1 ? 's' : ''}
          </p>
        )}
        {holiday.isPast && (
          <p className="mt-1 text-xs text-slate-400">Passed</p>
        )}
      </div>

      {/* Type badge */}
      <div className="shrink-0">
        <HolidayBadge type={holiday.holidayType} />
      </div>
    </div>
  )
}

export default function MyHolidays() {
  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    // Fetch 180 days (roughly 6 months ahead) plus current-month past holidays
    attendanceApi
      .holidaysUpcoming(180)
      .then((rows) => setHolidays(rows || []))
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [])

  const upcoming = holidays.filter((h) => !h.isPast && h.daysUntil > 0)
  const todayHol = holidays.filter((h) => h.daysUntil === 0)
  const past = holidays.filter((h) => h.isPast)

  const nextHoliday = upcoming[0] ?? null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Holidays"
        subtitle="Upcoming public and office holidays"
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Next holiday banner ── */}
      {!loading && nextHoliday && (
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-6 py-5 text-white shadow-md">
          <HiOutlineCalendarDays className="h-8 w-8 shrink-0 opacity-80" />
          <div>
            <p className="text-sm font-medium opacity-80">Next holiday</p>
            <p className="text-lg font-bold">{nextHoliday.holidayName}</p>
            <p className="text-sm opacity-80">
              {dmy(nextHoliday.date)} · In {nextHoliday.daysUntil} day{nextHoliday.daysUntil !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

      {/* ── Holiday list ── */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : holidays.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <HiOutlineCalendarDays className="h-12 w-12 text-slate-300 mb-3" />
          <p className="text-base font-medium text-slate-500">No holidays in the next 180 days</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Today */}
          {todayHol.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-violet-600">Today</h2>
              <div className="space-y-2">
                {todayHol.map((h) => <HolidayCard key={h.holidayId} holiday={h} />)}
              </div>
            </section>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Upcoming</h2>
              <div className="space-y-2">
                {upcoming.map((h) => <HolidayCard key={h.holidayId} holiday={h} />)}
              </div>
            </section>
          )}

          {/* Past (this month) */}
          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Earlier this month</h2>
              <div className="space-y-2">
                {[...past].reverse().map((h) => <HolidayCard key={h.holidayId} holiday={h} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
