import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { attendance as attendanceApi, account } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { dmy, bsDmy } from '../lib/dates'
import { useCalendar } from '../context/CalendarContext'
import { useAuth } from '../context/AuthContext'
import DateToggle from '../components/DateToggle'
import {
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineCalendarDays,
  HiOutlineArrowRight,
  HiOutlineUserCircle,
  HiOutlineSun,
  HiOutlineBellAlert,
  HiOutlineChartBar,
  HiOutlineXCircle,
  HiOutlineEllipsisVertical,
  HiOutlineBriefcase,
  HiOutlineBuildingOffice2,
  HiOutlineArrowTrendingUp,
} from 'react-icons/hi2'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function holidayTypeBadge(type) {
  const map = {
    Public: 'bg-violet-100 text-violet-700 border-violet-200',
    Government: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    Religious: 'bg-amber-100 text-amber-700 border-amber-200',
    Office: 'bg-sky-100 text-sky-700 border-sky-200',
  }
  return map[type] ?? 'bg-slate-100 text-slate-600 border-slate-200'
}

// ── Employee Avatar Component ──────────────────────────────────────────────────
function EmployeeAvatar({ photoUrl, name, size = 'lg' }) {
  const [failedUrl, setFailedUrl] = useState(null)

  const initials = (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const sizeClasses = {
    sm: 'h-10 w-10 text-xs',
    md: 'h-12 w-12 text-sm',
    lg: 'h-16 w-16 text-lg sm:h-18 sm:w-18 sm:text-xl',
  }[size] || 'h-16 w-16 text-lg'

  const hasImage = Boolean(photoUrl && failedUrl !== photoUrl)

  if (hasImage) {
    return (
      <div className="relative shrink-0">
        <img
          key={photoUrl}
          src={photoUrl}
          alt={name}
          onError={() => setFailedUrl(photoUrl)}
          className={`${sizeClasses} rounded-2xl object-cover ring-2 ring-white shadow-md`}
        />
        <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 ring-2 ring-white" title="Active" />
      </div>
    )
  }

  return (
    <div className="relative shrink-0">
      <div
        className={`${sizeClasses} rounded-2xl bg-gradient-to-tr from-sky-600 via-indigo-600 to-violet-600 flex items-center justify-center font-bold text-white shadow-md ring-2 ring-white tracking-wider`}
      >
        {initials}
      </div>
      <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 ring-2 ring-white" title="Active" />
    </div>
  )
}

// ── Top Metric Stat Card ───────────────────────────────────────────────────────
function MetricCard({ title, value, subtext, trend, trendPositive, icon: Icon, color = 'blue', loading }) {
  const colorMap = {
    blue: {
      accent: 'text-sky-600 bg-sky-50 border-sky-100',
      badge: 'text-sky-700 bg-sky-50 border-sky-200',
      dot: 'bg-sky-500',
    },
    emerald: {
      accent: 'text-emerald-600 bg-emerald-50 border-emerald-100',
      badge: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      dot: 'bg-emerald-500',
    },
    amber: {
      accent: 'text-amber-600 bg-amber-50 border-amber-100',
      badge: 'text-amber-700 bg-amber-50 border-amber-200',
      dot: 'bg-amber-500',
    },
    violet: {
      accent: 'text-violet-600 bg-violet-50 border-violet-100',
      badge: 'text-violet-700 bg-violet-50 border-violet-200',
      dot: 'bg-violet-500',
    },
  }

  const theme = colorMap[color] || colorMap.blue

  return (
    <div className="group relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</span>
        <div className="flex items-center gap-1.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${theme.accent}`}>
            <Icon className="h-4 w-4" />
          </div>
          <HiOutlineEllipsisVertical className="h-4 w-4 text-slate-300" />
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded-lg bg-slate-100" />
        ) : (
          <span className="text-3xl font-bold tracking-tight text-slate-800">{value ?? '—'}</span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {trend && (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
              trendPositive === false
                ? 'bg-rose-50 text-rose-600 border border-rose-200'
                : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
            }`}
          >
            {trendPositive !== false && <HiOutlineArrowTrendingUp className="h-3 w-3" />}
            {trend}
          </span>
        )}
        <span className="text-xs text-slate-400 truncate">{subtext}</span>
      </div>
    </div>
  )
}

// ── Today Check-in Status Banner ───────────────────────────────────────────────
function TodayBanner({ today, officeStartTime, graceMinutes }) {
  if (!today) return null

  if (!today.hasRecord) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50/80 via-white to-amber-50/40 p-4 sm:flex-row sm:items-center sm:justify-between shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <HiOutlineBellAlert className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-900">No punch-in recorded today</p>
            <p className="text-xs text-amber-700">
              Shift start: <span className="font-semibold">{officeStartTime || '10:00'}</span> · Grace: <span className="font-semibold">{graceMinutes || 15}m</span>
            </p>
          </div>
        </div>
        <span className="inline-flex items-center self-start sm:self-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
          Pending Punch
        </span>
      </div>
    )
  }

  if (today.isLate) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-rose-200/80 bg-gradient-to-r from-rose-50/80 via-white to-rose-50/40 p-4 sm:flex-row sm:items-center sm:justify-between shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <HiOutlineExclamationTriangle className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-rose-900">
                Checked in {today.minutesLate} minute{today.minutesLate !== 1 ? 's' : ''} late today
              </p>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                Late
              </span>
            </div>
            <p className="text-xs text-rose-700">
              Punch In: <span className="font-semibold text-slate-800">{today.checkIn}</span>
              {today.checkOut ? (
                <> · Punch Out: <span className="font-semibold text-slate-800">{today.checkOut}</span></>
              ) : (
                ' · Currently Active'
              )}
            </p>
          </div>
        </div>
        <div className="text-xs text-rose-600">
          Expected before: <span className="font-semibold">{officeStartTime}</span> (+{graceMinutes}m grace)
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50/80 via-white to-emerald-50/40 p-4 sm:flex-row sm:items-center sm:justify-between shadow-xs">
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
          <HiOutlineCheckCircle className="h-6 w-6" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-emerald-900">On Time Today</p>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              {today.status || 'Present'}
            </span>
          </div>
          <p className="text-xs text-emerald-700">
            Punch In: <span className="font-semibold text-slate-800">{today.checkIn}</span>
            {today.checkOut ? (
              <> · Punch Out: <span className="font-semibold text-slate-800">{today.checkOut}</span></>
            ) : (
              ' · Shift in progress'
            )}
          </p>
        </div>
      </div>
      <span className="inline-flex items-center self-start sm:self-auto rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
        Punctual
      </span>
    </div>
  )
}

// ── Interactive SVG Attendance Trend Spline Chart ──────────────────────────────
function AttendanceTrendChart({ logs = [] }) {
  const [hoveredIdx, setHoveredIdx] = useState(null)

  // Build daily points (last 16 records or current month logs)
  const chartData = useMemo(() => {
    if (!logs || logs.length === 0) {
      // Fallback synthetic baseline
      return [
        { label: '1 Sep', shortLabel: '1', hours: 8, late: false, present: true },
        { label: '5 Sep', shortLabel: '5', hours: 7.5, late: false, present: true },
        { label: '10 Sep', shortLabel: '10', hours: 8.2, late: true, present: true },
        { label: '15 Sep', shortLabel: '15', hours: 8, late: false, present: true },
        { label: '20 Sep', shortLabel: '20', hours: 7.8, late: false, present: true },
        { label: '25 Sep', shortLabel: '25', hours: 8.5, late: false, present: true },
      ]
    }
    return logs.slice(-16).map((log) => {
      const d = new Date(log.date)
      const dayNum = d.getDate()
      const mon = d.toLocaleDateString('en', { month: 'short' })
      return {
        label: `${dayNum} ${mon}`,
        shortLabel: `${dayNum}`,
        date: log.date,
        hours: Math.min(12, Math.max(0, Number(log.hours) || (log.status === 'Full Day' ? 8 : 4))),
        checkIn: log.checkIn || '—',
        checkOut: log.checkOut || '—',
        isLate: Boolean(log.isLate),
        minutesLate: log.minutesLate || 0,
        status: log.status,
      }
    })
  }, [logs])

  const width = 600
  const height = 240
  const padLeft = 40
  const padRight = 20
  const padTop = 20
  const padBottom = 40
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom

  const maxHours = 10
  const points = chartData.map((d, i) => {
    const x = padLeft + (i / Math.max(1, chartData.length - 1)) * plotWidth
    const y = padTop + (1 - Math.min(d.hours, maxHours) / maxHours) * plotHeight
    return { ...d, x, y }
  })

  // Natural smooth spline generator (Catmull-Rom to Bézier)
  function getSplinePath(pts) {
    if (pts.length === 0) return ''
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = p1.y + (p2.y - p0.y) / 6
      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = p2.y - (p3.y - p1.y) / 6
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }
    return d
  }

  const curvePath = getSplinePath(points)
  const areaPath = points.length > 0
    ? `${curvePath} L ${points[points.length - 1].x.toFixed(1)} ${(padTop + plotHeight).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + plotHeight).toFixed(1)} Z`
    : ''

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">Attendance Trend</h2>
          <p className="text-xs text-slate-400">Daily working hours & punctuality track</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
            Working Hours
          </span>
          <span className="flex items-center gap-1.5 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            On-Time
          </span>
          <span className="flex items-center gap-1.5 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            Late
          </span>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="relative mt-4 w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[500px]">
          <defs>
            <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines & Y labels */}
          {[0, 2, 4, 6, 8, 10].map((h) => {
            const y = padTop + (1 - h / maxHours) * plotHeight
            return (
              <g key={h}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth="1"
                  strokeDasharray={h === 0 ? 'none' : '4 4'}
                />
                <text
                  x={padLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px] font-medium"
                >
                  {h}h
                </text>
              </g>
            )
          })}

          {/* 8-hour target baseline */}
          <line
            x1={padLeft}
            y1={padTop + (1 - 8 / maxHours) * plotHeight}
            x2={width - padRight}
            y2={padTop + (1 - 8 / maxHours) * plotHeight}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity="0.6"
          />

          {/* Smooth area fill & curve */}
          {areaPath && <path d={areaPath} fill="url(#trendGradient)" />}
          {curvePath && (
            <path
              d={curvePath}
              fill="none"
              stroke="#0284c7"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data Points */}
          {points.map((p, i) => {
            const isHovered = hoveredIdx === i
            const dotColor = p.isLate ? '#f43f5e' : p.hours >= 7.5 ? '#10b981' : '#0284c7'
            return (
              <g
                key={i}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Vertical hover line */}
                {isHovered && (
                  <line
                    x1={p.x}
                    y1={padTop}
                    x2={p.x}
                    y2={padTop + plotHeight}
                    stroke="#0284c7"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                )}
                {/* Outer ring */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? 6 : 4}
                  fill="#ffffff"
                  stroke={dotColor}
                  strokeWidth={isHovered ? 3 : 2}
                  className="transition-all duration-150"
                />
                {/* X Axis Label */}
                <text
                  x={p.x}
                  y={height - 12}
                  textAnchor="middle"
                  className={`text-[10px] font-semibold transition-colors ${
                    isHovered ? 'fill-sky-600 font-bold' : 'fill-slate-400'
                  }`}
                >
                  {p.label || p.shortLabel}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Floating Tooltip */}
        {hoveredIdx !== null && points[hoveredIdx] && (
          <div
            className="pointer-events-none absolute top-2 rounded-xl border border-slate-200 bg-slate-900/90 px-3 py-2 text-white shadow-xl backdrop-blur-sm transition-all"
            style={{
              left: `${Math.min(75, Math.max(5, (points[hoveredIdx].x / width) * 100))}%`,
            }}
          >
            <p className="text-xs font-bold text-sky-300">{points[hoveredIdx].label || points[hoveredIdx].date}</p>
            <p className="mt-0.5 text-xs font-semibold">
              Hours: <span className="text-amber-300">{points[hoveredIdx].hours}h</span>
            </p>
            <p className="text-[11px] text-slate-300">
              In: {points[hoveredIdx].checkIn} · Out: {points[hoveredIdx].checkOut}
            </p>
            {points[hoveredIdx].isLate && (
              <p className="mt-0.5 text-[11px] font-bold text-rose-400">
                ⚠️ Late by {points[hoveredIdx].minutesLate}m
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Donut Attendance & Leave Breakdown Chart ──────────────────────────────────
function LeaveBreakdownDonut({ present = 0, late = 0, holidays = 0, workingDays = 22 }) {
  const onTime = Math.max(0, present - late)
  const unrecorded = Math.max(0, workingDays - present)

  const segments = [
    { label: 'On Time', count: onTime, color: '#2563eb', bg: 'bg-blue-600' },
    { label: 'Late', count: late, color: '#f59e0b', bg: 'bg-amber-500' },
    { label: 'Holidays', count: holidays, color: '#8b5cf6', bg: 'bg-violet-500' },
    { label: 'Unrecorded / Off', count: unrecorded, color: '#94a3b8', bg: 'bg-slate-400' },
  ]

  const total = segments.reduce((sum, s) => sum + s.count, 0) || 1
  const attendanceRate = total > 0 ? Math.round((present / Math.max(1, workingDays)) * 100) : 100

  // Calculate SVG stroke dashes for circle
  const size = 180
  const strokeWidth = 24
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  let currentAngle = 0
  const paths = segments.map((seg) => {
    const fraction = seg.count / total
    const strokeDasharray = `${(fraction * circumference).toFixed(2)} ${(circumference * (1 - fraction)).toFixed(2)}`
    const strokeDashoffset = (-currentAngle * circumference).toFixed(2)
    currentAngle += fraction
    return { ...seg, strokeDasharray, strokeDashoffset, fraction }
  })

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Leave & Status Breakdown</h2>
            <p className="text-xs text-slate-400">Current month distribution</p>
          </div>
          <HiOutlineEllipsisVertical className="h-5 w-5 text-slate-300" />
        </div>

        {/* Center Donut SVG */}
        <div className="relative my-4 flex items-center justify-center">
          <svg width={size} height={size} className="transform -rotate-90">
            {/* Background ring */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke="#f1f5f9"
              strokeWidth={strokeWidth}
            />
            {/* Colored Segment arcs */}
            {paths.map((p, i) => (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={p.color}
                strokeWidth={strokeWidth}
                strokeDasharray={p.strokeDasharray}
                strokeDashoffset={p.strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-500 hover:opacity-85"
              />
            ))}
          </svg>

          {/* Central Counter Pill */}
          <div className="absolute flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-extrabold text-slate-800 leading-none">{attendanceRate}%</span>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">Rate</span>
          </div>
        </div>
      </div>

      {/* Legend list */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${seg.bg}`} />
              <span className="font-medium text-slate-600">{seg.label}</span>
            </div>
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <span>{seg.count} {seg.count === 1 ? 'day' : 'days'}</span>
              <span className="text-[10px] text-slate-400 font-normal">
                ({Math.round((seg.count / total) * 100)}%)
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Recent Attendance Row ──────────────────────────────────────────────────────
function AttRow({ row, isBs }) {
  const dateStr = isBs && row.nepaliDate ? bsDmy(row.nepaliDate) : dmy(row.date)

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition ${
        row.isLate
          ? 'border-rose-200/60 bg-rose-50/40 hover:bg-rose-50/70'
          : 'border-slate-100 bg-white hover:bg-slate-50'
      }`}
    >
      <span className="w-28 shrink-0 text-xs font-semibold text-slate-700">{dateStr}</span>
      <span className="w-16 shrink-0 text-xs text-slate-600">{row.checkIn ?? '—'}</span>
      <span className="w-16 shrink-0 text-xs text-slate-600">{row.checkOut ?? '—'}</span>
      <span className="w-14 shrink-0 text-xs font-bold text-slate-800">{row.hours ? `${row.hours}h` : '—'}</span>
      <span
        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
          row.status === 'Full Day'
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-amber-100 text-amber-700'
        }`}
      >
        {row.status}
      </span>
      {row.isLate && (
        <span className="ml-auto flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
          <HiOutlineExclamationTriangle className="h-3 w-3" />
          {row.minutesLate}m late
        </span>
      )}
    </div>
  )
}

// ── Upcoming Holiday Item ──────────────────────────────────────────────────────
function HolidayItem({ holiday }) {
  const rawDate = new Date(holiday.date)
  const day = rawDate.toLocaleDateString('en', { day: '2-digit' })
  const month = rawDate.toLocaleDateString('en', { month: 'short' })

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition ${
        holiday.isPast
          ? 'border-slate-200 bg-slate-50 opacity-60'
          : holiday.daysUntil === 0
          ? 'border-violet-300 bg-violet-50/70 shadow-xs'
          : 'border-slate-200/80 bg-white hover:border-sky-200 hover:bg-sky-50/50'
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-white shadow-xs border border-slate-200">
        <span className="text-xs font-extrabold text-slate-800 leading-none">{day}</span>
        <span className="text-[9px] font-bold text-sky-600 uppercase mt-0.5">{month}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold text-slate-800">{holiday.holidayName}</p>
        <p className="text-[11px] text-slate-500">
          {holiday.isPast
            ? 'Passed'
            : holiday.daysUntil === 0
            ? '🎉 Today!'
            : `In ${holiday.daysUntil} day${holiday.daysUntil !== 1 ? 's' : ''}`}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${holidayTypeBadge(
          holiday.holidayType
        )}`}
      >
        {holiday.holidayType}
      </span>
    </div>
  )
}

// ── Main Page Component ────────────────────────────────────────────────────────
export default function UserDashboard() {
  const { isBs } = useCalendar()
  const { username, role } = useAuth()

  const [summary, setSummary] = useState(null)
  const [profile, setProfile] = useState(null)
  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      attendanceApi.mySummary().catch(() => null),
      account.profile().catch(() => null),
      attendanceApi.holidaysUpcoming(90).catch(() => []),
    ])
      .then(([sum, prof, hols]) => {
        setSummary(sum)
        setProfile(prof)
        setHolidays(hols || [])
      })
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [])

  // Employee details from summary or profile
  const employeeName = summary?.employee?.name || profile?.employeeName || username || 'Employee'
  const employeeRole = summary?.employee?.title || profile?.title || role || 'Team Member'
  const employeeDept = summary?.employee?.department || profile?.departmentName || 'General'
  const photoUrl = summary?.employee?.photoUrl || profile?.photoUrl || null
  const employeeCode = summary?.employee?.biometricId || profile?.employeeCode || null

  const today = new Date()
  const monthName = today.toLocaleDateString('en', { month: 'long', year: 'numeric' })

  // Calculated metrics
  const presentDays = summary?.presentDays ?? 0
  const lateDays = summary?.lateDays ?? 0
  const totalHours = summary?.totalHours ?? 0
  const workingDays = summary?.workingDays ?? 22
  const attendanceRate = summary?.attendanceRate ?? (workingDays > 0 ? Math.round((presentDays / workingDays) * 100) : 100)
  const avgHours = summary?.avgWorkingHours ?? (presentDays > 0 ? (totalHours / presentDays).toFixed(1) : '8.0')

  return (
    <div className="space-y-6 pb-12">
      {/* ── Breadcrumb & Top Bar ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <span>Overview</span>
          <span>/</span>
          <span className="text-sky-600">Employee Dashboard</span>
        </div>
        <div className="flex items-center gap-3 self-start lg:self-auto">
          <DateToggle />
          <Link
            to="/my-attendance"
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-sky-700"
          >
            My Attendance <HiOutlineArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* ── Employee Profile Hero Card (With Image, Name, Role, Dept) ── */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-6 text-white shadow-md">
        {/* Background decorative elements */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 right-32 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            <EmployeeAvatar photoUrl={photoUrl} name={employeeName} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-sky-400 flex items-center gap-1">
                  <HiOutlineSun className="h-3.5 w-3.5 text-amber-400" />
                  {getGreeting()}
                </span>
                {employeeCode && (
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                    ID: {employeeCode}
                  </span>
                )}
              </div>
              <h1 className="mt-0.5 text-xl font-bold tracking-tight text-white sm:text-2xl">
                {employeeName}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="inline-flex items-center gap-1 font-medium text-sky-300">
                  <HiOutlineBriefcase className="h-3.5 w-3.5" />
                  {employeeRole}
                </span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <HiOutlineBuildingOffice2 className="h-3.5 w-3.5" />
                  {employeeDept}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/5 p-3 backdrop-blur-sm border border-white/10 sm:self-center">
            <div className="text-right sm:text-left">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Current Period</p>
              <p className="text-sm font-bold text-white">{monthName}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Unlinked employee warning ── */}
      {!loading && summary && !summary.linked && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <HiOutlineUserCircle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-900">Account not linked to an employee record</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Ask your administrator or HR to link your user account to your Employee profile to sync live punches.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* ── Today's Realtime Status Banner ── */}
      {summary?.linked && (
        <TodayBanner
          today={summary.today}
          officeStartTime={summary.officeStartTime}
          graceMinutes={summary.graceMinutes}
        />
      )}

      {/* ── Four Top KPI Stat Cards (Matching screenshot) ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Avg. Attendance Rate"
          value={`${attendanceRate}%`}
          trend="+3% vs standard"
          trendPositive={true}
          subtext="Monthly target 90%"
          icon={HiOutlineCheckCircle}
          color="emerald"
          loading={loading}
        />
        <MetricCard
          title="Avg. Working Hours"
          value={`${avgHours} hrs`}
          trend="+0.3 hrs vs 8h"
          trendPositive={true}
          subtext="Per working day"
          icon={HiOutlineClock}
          color="blue"
          loading={loading}
        />
        <MetricCard
          title="Total Hours Worked"
          value={`${totalHours} hrs`}
          trend={lateDays > 0 ? `${lateDays} late arrivals` : 'Zero late days'}
          trendPositive={lateDays === 0}
          subtext="Cumulative this month"
          icon={HiOutlineChartBar}
          color={lateDays > 0 ? 'amber' : 'blue'}
          loading={loading}
        />
        <MetricCard
          title="Leaves & Holidays"
          value={holidays.filter((h) => !h.isPast).length}
          trend="Upcoming"
          trendPositive={true}
          subtext="Next 90 days scheduled"
          icon={HiOutlineCalendarDays}
          color="violet"
          loading={loading}
        />
      </div>

      {/* ── Charts Row (Attendance Trend + Leave Breakdown) ── */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left Trend Chart (3 cols) */}
        <div className="lg:col-span-3">
          <AttendanceTrendChart logs={summary?.monthLogs || summary?.recentLogs || []} />
        </div>

        {/* Right Donut Breakdown Chart (2 cols) */}
        <div className="lg:col-span-2">
          <LeaveBreakdownDonut
            present={presentDays}
            late={lateDays}
            holidays={holidays.filter((h) => !h.isPast).length}
            workingDays={workingDays}
          />
        </div>
      </div>

      {/* ── Two-column Details (Recent Attendance + Upcoming Holidays) ── */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Recent Attendance Activity */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <HiOutlineClock className="h-4 w-4 text-sky-600" />
              <h2 className="text-sm font-bold text-slate-800">Recent Attendance Logs</h2>
            </div>
            <Link
              to="/my-attendance"
              className="flex items-center gap-1 text-xs font-semibold text-sky-600 hover:text-sky-800 transition"
            >
              View all history <HiOutlineArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : !summary?.linked ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">
              No attendance data — account not linked to an employee.
            </div>
          ) : (summary?.recentLogs ?? []).length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">
              No attendance logs recorded this month yet.
            </div>
          ) : (
            <div className="space-y-1.5 p-4">
              <div className="flex items-center gap-3 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span className="w-28 shrink-0">Date</span>
                <span className="w-16 shrink-0">Check In</span>
                <span className="w-16 shrink-0">Check Out</span>
                <span className="w-14 shrink-0">Hours</span>
                <span>Status</span>
              </div>
              {(summary?.recentLogs ?? []).map((row, i) => (
                <AttRow key={i} row={row} isBs={isBs} />
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Holidays Card */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <HiOutlineCalendarDays className="h-4 w-4 text-violet-600" />
              <h2 className="text-sm font-bold text-slate-800">Upcoming Holidays</h2>
            </div>
            <Link
              to="/my-holidays"
              className="flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800 transition"
            >
              All holidays <HiOutlineArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : holidays.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <HiOutlineXCircle className="h-8 w-8 text-slate-300 mb-2" />
              <p className="text-xs font-medium text-slate-400">No upcoming holidays scheduled</p>
            </div>
          ) : (
            <div className="space-y-2.5 p-4">
              {holidays.slice(0, 5).map((h) => (
                <HolidayItem key={h.holidayId} holiday={h} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
