import { NavLink } from 'react-router-dom'
import { HiOutlineCalendarDays, HiOutlineTableCells, HiOutlineChartBarSquare } from 'react-icons/hi2'

export default function ReportTabs() {
  const tabs = [
    { to: '/reports/daily', label: 'Daily Report', icon: HiOutlineCalendarDays },
    { to: '/reports/monthly', label: 'Monthly Matrix', icon: HiOutlineTableCells },
    { to: '/reports/summary', label: 'Summary & Stats', icon: HiOutlineChartBarSquare },
  ]

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${
                isActive
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200'
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{tab.label}</span>
          </NavLink>
        )
      })}
    </div>
  )
}
