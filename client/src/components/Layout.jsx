import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  HiOutlineSquares2X2,
  HiOutlineClock,
  HiOutlineCheckBadge,
  HiOutlineCalendarDays,
  HiOutlineDocumentText,
  HiOutlineTableCells,
  HiOutlineChartBarSquare,
  HiOutlineUsers,
  HiOutlineUserPlus,
  HiOutlineBuildingOffice2,
  HiOutlineMapPin,
  HiOutlineIdentification,
  HiOutlineCog6Tooth,
  HiOutlineExclamationTriangle,
  HiOutlineUserCircle,
  HiOutlineCalendarDateRange,
  HiOutlineBriefcase,
} from 'react-icons/hi2'
import { useAuth } from '../context/AuthContext'
import NotificationBell from './NotificationBell'

export default function Layout() {
  const { username, role, isManager, isAdmin, signOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const navContent = (
    <>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3 scrollbar-thin scrollbar-thumb-slate-700">
        {isManager ? (
          <>
            <div>
              <SectionHeader title="Overview" />
              <div className="space-y-0.5">
                <NavItem to="/" label="Dashboard" icon={HiOutlineSquares2X2} end />
              </div>
            </div>

            <div>
              <SectionHeader title="Attendance & Time" />
              <div className="space-y-0.5">
                <NavItem to="/attendance" label="Attendance" icon={HiOutlineClock} />
                <NavItem to="/shifts" label="Work Shifts" icon={HiOutlineBriefcase} />
                <NavItem to="/attendance/approvals" label="Late Approvals" icon={HiOutlineCheckBadge} />
                <NavItem to="/leave-requests" label="Leave Approvals" icon={HiOutlineCalendarDateRange} />
                <NavItem to="/holidays" label="Holidays" icon={HiOutlineCalendarDays} />
              </div>
            </div>

            <div>
              <SectionHeader title="Reports & Analytics" />
              <div className="space-y-0.5">
                <NavItem to="/reports/daily" label="Daily Report" icon={HiOutlineDocumentText} />
                <NavItem to="/reports/monthly" label="Monthly Matrix" icon={HiOutlineTableCells} />
                <NavItem to="/reports/summary" label="Summary Report" icon={HiOutlineChartBarSquare} />
              </div>
            </div>

            <div>
              <SectionHeader title="Organization" />
              <div className="space-y-0.5">
                <NavItem to="/employees" label="Employees" icon={HiOutlineUsers} end />
                {isAdmin && (
                  <NavItem to="/employees/pending" label="Pending Approvals" icon={HiOutlineUserPlus} />
                )}
                <NavItem to="/departments" label="Departments" icon={HiOutlineBuildingOffice2} />
                <NavItem to="/shifts" label="Work Shifts" icon={HiOutlineBriefcase} />
                <NavItem to="/branches" label="Branches" icon={HiOutlineMapPin} />
                <NavItem to="/unregistered" label="Unregistered IDs" icon={HiOutlineIdentification} />
              </div>
            </div>

            <div>
              <SectionHeader title="Administration" />
              <div className="space-y-0.5">
                <NavItem to="/settings" label="Settings" icon={HiOutlineCog6Tooth} />
                <NavItem to="/errors" label="Error Log" icon={HiOutlineExclamationTriangle} />
              </div>
            </div>
          </>
        ) : (
          <div>
            <SectionHeader title="Personal" />
            <div className="space-y-0.5">
              <NavItem to="/" label="Dashboard" icon={HiOutlineSquares2X2} end />
              <NavItem to="/my-attendance" label="My Attendance" icon={HiOutlineClock} />
              <NavItem to="/leave-requests" label="Request Leave" icon={HiOutlineCalendarDateRange} />
              <NavItem to="/my-holidays" label="Holidays" icon={HiOutlineCalendarDays} />
            </div>
          </div>
        )}

        <div className="pt-2">
          <div className="border-t border-slate-800/80 my-2" />
          <NavItem to="/profile" label="Profile & Security" icon={HiOutlineUserCircle} />
        </div>
      </nav>

      <div className="shrink-0 border-t border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
        <div className="font-semibold text-slate-200 truncate">{username}</div>
        <div className="text-[11px] text-slate-400 truncate">{role}</div>
        <button
          type="button"
          onClick={signOut}
          className="mt-2 w-full rounded bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-rose-950 hover:text-rose-200 border border-slate-700 hover:border-rose-800 transition text-center"
        >
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-slate-50">
      {/* ── Mobile Topbar (screen < md) ── */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 text-slate-100 md:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition"
            aria-label="Open menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-base font-semibold tracking-tight">
            ZK<span className="text-sky-400">Attendance</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
        </div>
      </header>

      {/* ── Mobile Drawer Backdrop & Menu (screen < md) ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative flex h-full w-64 max-w-[82vw] flex-1 flex-col bg-slate-900 text-slate-100 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-slate-800">
              <span className="text-lg font-semibold tracking-tight">
                ZK<span className="text-sky-400">Attendance</span>
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
                aria-label="Close menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {navContent}
          </div>
        </div>
      )}

      {/* ── Desktop Sidebar (screen >= md) ── */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-slate-900 text-slate-100 md:flex z-30 border-r border-slate-800 shadow-lg">
        <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-slate-800/80">
          <span className="text-lg font-bold tracking-tight">
            ZK<span className="text-sky-400">Attendance</span>
          </span>
          <NotificationBell />
        </div>
        {navContent}
      </aside>

      {/* ── Main Content Area ── */}
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div className="px-2 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
      {title}
    </div>
  )
}

function NavItem({ to, label, icon: Icon, badge, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
          isActive
            ? 'bg-sky-600 text-white shadow-xs font-semibold'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`
      }
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 opacity-80" />}
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold">
          {badge}
        </span>
      )}
    </NavLink>
  )
}

