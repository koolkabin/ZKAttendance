import { useEffect, useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { leaveRequests as leaveApi } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { dmy, bsDmy, ymd } from '../lib/dates'
import { adToBs } from '../lib/nepaliCalendar'
import { useCalendar } from '../context/CalendarContext'
import { useAuth } from '../context/AuthContext'
import { Modal } from '../components/ui'
import {
  HiOutlineDocumentText,
  HiOutlineUserGroup,
  HiOutlineArrowDownTray,
  HiOutlinePlus,
  HiOutlineMagnifyingGlass,
  HiOutlineEllipsisHorizontal,
  HiOutlineEye,
  HiOutlinePencilSquare,
  HiOutlinePaperAirplane,
  HiOutlineTrash,
  HiOutlineCheckCircle,
  HiOutlineXMark,
  HiOutlineClock,
  HiOutlineCalendarDateRange,
  HiOutlineCheck,
  HiOutlineCalendarDays,
  HiOutlineBellAlert,
} from 'react-icons/hi2'

const LEAVE_TYPES = [
  'Casual Leave',
  'Sick Leave',
  'Annual Leave',
  'Maternity Leave',
  'Paternity Leave',
  'Bereavement Leave',
  'Other',
]

function statusBadge(status) {
  const map = {
    Draft: 'bg-slate-100 text-slate-700 border-slate-200',
    Pending: 'bg-amber-50 text-amber-700 border-amber-200',
    Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Rejected: 'bg-rose-50 text-rose-700 border-rose-200',
    Cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  }
  return map[status] || 'bg-slate-100 text-slate-600 border-slate-200'
}

export default function LeaveRequests() {
  const { isManager } = useAuth()

  return isManager ? <AdminLeaveView /> : <EmployeeLeaveView />
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. EMPLOYEE VIEW: "Request Leave"
// ═══════════════════════════════════════════════════════════════════════════════

function EmployeeLeaveView() {
  const { isBs } = useCalendar()
  const { username } = useAuth()

  const [list, setList] = useState([])
  const [summaryData, setSummaryData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const [statusFilter, setStatusFilter] = useState('All')
  const [search, setSearch] = useState('')

  // Modals
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [viewingItem, setViewingItem] = useState(null)
  const [activeMenuId, setActiveMenuId] = useState(null)

  // Form
  const [form, setForm] = useState({
    leaveType: 'Casual Leave',
    startDate: ymd(new Date()),
    endDate: ymd(new Date()),
    nepaliStartDate: '',
    nepaliEndDate: '',
    isHalfDay: false,
    halfDayPeriod: 'FirstHalf',
    reason: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const fetchMyLeaves = async () => {
    setLoading(true)
    setError('')
    try {
      const [items, sum] = await Promise.all([
        leaveApi.list({
          status: statusFilter !== 'All' ? statusFilter : undefined,
        }),
        leaveApi.summary().catch(() => null),
      ])
      setList(items || [])
      setSummaryData(sum)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMyLeaves()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  useEffect(() => {
    function handleClickOutside() {
      setActiveMenuId(null)
    }
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  const filteredList = useMemo(() => {
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(
      (r) =>
        r.leaveType?.toLowerCase().includes(q) ||
        r.reason?.toLowerCase().includes(q) ||
        r.nepaliStartDate?.includes(q) ||
        r.nepaliEndDate?.includes(q)
    )
  }, [list, search])

  const handleOpenApply = () => {
    const today = new Date()
    const todayYmd = ymd(today)
    const bs = adToBs(today)
    setForm({
      leaveType: 'Casual Leave',
      startDate: todayYmd,
      endDate: todayYmd,
      nepaliStartDate: bs?.dateBs || '',
      nepaliEndDate: bs?.dateBs || '',
      isHalfDay: false,
      halfDayPeriod: 'FirstHalf',
      reason: '',
    })
    setEditingItem(null)
    setFormError('')
    setShowApplyModal(true)
  }

  const handleOpenEdit = (item) => {
    setForm({
      leaveType: item.leaveType,
      startDate: item.startDate,
      endDate: item.endDate,
      nepaliStartDate: item.nepaliStartDate || '',
      nepaliEndDate: item.nepaliEndDate || '',
      isHalfDay: Boolean(item.isHalfDay),
      halfDayPeriod: item.halfDayPeriod || 'FirstHalf',
      reason: item.reason || '',
    })
    setEditingItem(item)
    setFormError('')
    setShowApplyModal(true)
    setActiveMenuId(null)
  }

  const handleSubmitForm = async (submitNow = false) => {
    if (!form.reason.trim()) {
      setFormError('Please enter a reason for the leave request.')
      return
    }
    if (form.startDate > form.endDate) {
      setFormError('Start date cannot be after end date.')
      return
    }

    setSubmitting(true)
    setFormError('')
    try {
      const payload = {
        ...form,
        submit: submitNow,
      }
      if (editingItem) {
        await leaveApi.update(editingItem.leaveRequestId, payload)
      } else {
        await leaveApi.create(payload)
      }
      setShowApplyModal(false)
      fetchMyLeaves()
    } catch (err) {
      setFormError(apiErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDirectSubmit = async (id) => {
    try {
      await leaveApi.submit(id)
      fetchMyLeaves()
    } catch (err) {
      alert(apiErrorMessage(err))
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this draft request?')) return
    try {
      await leaveApi.delete(id)
      fetchMyLeaves()
    } catch (err) {
      alert(apiErrorMessage(err))
    }
  }

  const formatCellDate = (adDate, bsDate) => {
    if (isBs && bsDate) return bsDmy(bsDate)
    return dmy(adDate)
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ── Employee Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 border border-sky-100 shadow-xs">
            <HiOutlineCalendarDateRange className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Request Leave</h1>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenApply}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-sky-700 transition self-start sm:self-auto"
        >
          <HiOutlinePlus className="h-4 w-4" />
          Apply for Leave
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* ── Personal Leave Stats Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/60 via-white to-emerald-50/20 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Approved Leaves</span>
            <HiOutlineCheckCircle className="h-5 w-5 text-emerald-500" />
          </div>
          <p className="mt-2 text-3xl font-extrabold text-slate-800">
            {summaryData?.approved ?? 0}{' '}
            <span className="text-xs font-semibold text-slate-400">requests</span>
          </p>
          <p className="mt-1 text-xs text-emerald-700">Approved by manager</p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 via-white to-amber-50/20 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Pending Review</span>
            <HiOutlineClock className="h-5 w-5 text-amber-500" />
          </div>
          <p className="mt-2 text-3xl font-extrabold text-slate-800">
            {summaryData?.pending ?? 0}{' '}
            <span className="text-xs font-semibold text-slate-400">requests</span>
          </p>
          <p className="mt-1 text-xs text-amber-700">Awaiting manager decision</p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Draft Requests</span>
            <HiOutlinePaperAirplane className="h-5 w-5 text-slate-400" />
          </div>
          <p className="mt-2 text-3xl font-extrabold text-slate-800">
            {summaryData?.draft ?? 0}{' '}
            <span className="text-xs font-semibold text-slate-400">saved</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">Not yet submitted for approval</p>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
        <div className="relative flex-1 max-w-sm">
          <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search your leave requests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-4 text-sm text-slate-800 placeholder-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400">Status:</span>
          {['All', 'Pending', 'Approved', 'Draft', 'Rejected'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                statusFilter === st
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* ── Employee Requests Table ── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="border-b border-slate-200/80 bg-slate-50/60 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Leave Type</th>
                <th className="px-4 py-3.5">From</th>
                <th className="px-4 py-3.5">To</th>
                <th className="px-4 py-3.5">Duration</th>
                <th className="px-4 py-3.5">Reason</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="7" className="p-8 text-center text-slate-400">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-sky-600 border-t-transparent mb-2" />
                    <p>Loading your leave requests...</p>
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-10 text-center text-slate-400">
                    <HiOutlineCalendarDays className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-700">No leave requests found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Click "+ Apply for Leave" to submit your application.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredList.map((row) => (
                  <tr key={row.leaveRequestId} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5 font-bold text-slate-800">{row.leaveType}</td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {formatCellDate(row.startDate, row.nepaliStartDate)}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {formatCellDate(row.endDate, row.nepaliEndDate)}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-700">
                      {row.totalDays} {row.totalDays === 1 ? 'day' : 'days'}
                      {row.isHalfDay && (
                        <span className="block text-[10px] text-slate-400 font-normal">
                          ({row.halfDayPeriod})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 max-w-xs truncate" title={row.reason}>
                      {row.reason}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusBadge(
                          row.status
                        )}`}
                      >
                        {row.status === 'Pending' ? 'Pending Approval' : row.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {row.canSubmit && (
                          <button
                            type="button"
                            onClick={() => handleDirectSubmit(row.leaveRequestId)}
                            className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-bold text-white shadow-xs hover:bg-sky-700 transition"
                            title="Submit for approval"
                          >
                            <HiOutlinePaperAirplane className="h-3.5 w-3.5" />
                            Submit
                          </button>
                        )}

                        {row.canEdit && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(row)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-2xs"
                            title="Edit request"
                          >
                            <HiOutlinePencilSquare className="h-3.5 w-3.5 text-slate-500" />
                            Edit
                          </button>
                        )}

                        {row.canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(row.leaveRequestId)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 transition shadow-2xs"
                            title={row.status === 'Draft' ? 'Delete draft' : 'Withdraw request'}
                          >
                            <HiOutlineTrash className="h-3.5 w-3.5 text-rose-500" />
                            {row.status === 'Draft' ? 'Delete' : 'Cancel'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setViewingItem(row)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                          title="View Details"
                        >
                          <HiOutlineEye className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Apply / Edit Leave Modal ── */}
      {showApplyModal && (
        <LeaveFormModal
          title={editingItem ? 'Edit Leave Request' : 'Apply for Leave'}
          form={form}
          setForm={setForm}
          submitting={submitting}
          formError={formError}
          onClose={() => setShowApplyModal(false)}
          onSubmit={handleSubmitForm}
        />
      )}

      {/* ── View Details Modal ── */}
      {viewingItem && (
        <LeaveDetailsModal item={viewingItem} onClose={() => setViewingItem(null)} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ADMIN / MANAGER VIEW: "Leave Approvals & Management"
// ═══════════════════════════════════════════════════════════════════════════════

function AdminLeaveView() {
  const { isBs } = useCalendar()

  // Tabs: 'pending' | 'all' | 'summary'
  const [adminTab, setAdminTab] = useState('pending')
  const [list, setList] = useState([])
  const [summaryData, setSummaryData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters for 'all' tab
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('All')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')

  // Modals & Actions
  const [viewingItem, setViewingItem] = useState(null)
  const [approvingItem, setApprovingItem] = useState(null)
  const [approveRemarks, setApproveRemarks] = useState('')
  const [rejectingItem, setRejectingItem] = useState(null)
  const [rejectRemarks, setRejectRemarks] = useState('')

  const fetchAdminData = async () => {
    setLoading(true)
    setError('')
    try {
      const [items, sum] = await Promise.all([
        leaveApi.list({
          search: search || undefined,
          status: adminTab === 'pending' ? 'Pending' : (statusFilter !== 'All' ? statusFilter : undefined),
          type: typeFilter !== 'All' ? typeFilter : undefined,
          from: fromFilter || undefined,
          to: toFilter || undefined,
        }),
        leaveApi.summary().catch(() => null),
      ])
      setList(items || [])
      setSummaryData(sum)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdminData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, statusFilter, typeFilter, fromFilter, toFilter])

  const pendingList = useMemo(() => {
    return list.filter((r) => r.status === 'Pending')
  }, [list])

  const filteredAllList = useMemo(() => {
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(
      (r) =>
        r.employeeName?.toLowerCase().includes(q) ||
        r.employeeCode?.toLowerCase().includes(q) ||
        r.leaveType?.toLowerCase().includes(q) ||
        r.reason?.toLowerCase().includes(q)
    )
  }, [list, search])

  // Approve action
  const handleApprove = async () => {
    if (!approvingItem) return
    try {
      await leaveApi.approve(approvingItem.leaveRequestId, approveRemarks)
      setApprovingItem(null)
      setApproveRemarks('')
      fetchAdminData()
    } catch (err) {
      alert(apiErrorMessage(err))
    }
  }

  // Reject action
  const handleReject = async () => {
    if (!rejectingItem) return
    try {
      await leaveApi.reject(rejectingItem.leaveRequestId, rejectRemarks)
      setRejectingItem(null)
      setRejectRemarks('')
      fetchAdminData()
    } catch (err) {
      alert(apiErrorMessage(err))
    }
  }

  // Quick 1-click approve from table row
  const handleQuickApprove = (row) => {
    setApprovingItem(row)
    setApproveRemarks('Approved as per policy')
  }

  // Quick 1-click reject dialog
  const handleQuickReject = (row) => {
    setRejectingItem(row)
    setRejectRemarks('')
  }

  const handleExportExcel = () => {
    const dataToExport = adminTab === 'pending' ? pendingList : filteredAllList
    if (dataToExport.length === 0) return

    const rows = dataToExport.map((r, i) => ({
      '#': i + 1,
      Employee: r.employeeName,
      'Biometric ID': r.employeeCode || '—',
      'Leave Type': r.leaveType,
      'From Date': r.startDate,
      'To Date': r.endDate,
      'From (BS)': r.nepaliStartDate || '—',
      'To (BS)': r.nepaliEndDate || '—',
      Days: r.totalDays,
      Status: r.status,
      Reason: r.reason,
      'Decided By': r.decidedBy || '—',
      'Admin Remarks': r.adminRemarks || '—',
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leave Approvals')
    XLSX.writeFile(workbook, `Leave_Approvals_${ymd(new Date())}.xlsx`)
  }

  const formatCellDate = (adDate, bsDate) => {
    if (isBs && bsDate) return bsDmy(bsDate)
    return dmy(adDate)
  }

  const pendingCount = summaryData?.pending ?? 0

  return (
    <div className="space-y-6 pb-12">
      {/* ── Admin Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-xs">
            <HiOutlineCalendarDateRange className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leave Approvals</h1>
              {pendingCount > 0 && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white animate-pulse">
                  {pendingCount} Pending
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">Review employee leave requests, approve or decline time-off</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 transition"
          >
            <HiOutlineArrowDownTray className="h-4 w-4 text-slate-500" />
            Export to Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* ── Pending Alert Banner if count > 0 ── */}
      {pendingCount > 0 && adminTab !== 'pending' && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
          <div className="flex items-center gap-3">
            <HiOutlineBellAlert className="h-5 w-5 text-amber-600 shrink-0" />
            <p className="text-sm font-semibold text-amber-900">
              There are <span className="font-bold">{pendingCount}</span> leave application(s) awaiting your decision.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdminTab('pending')}
            className="rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition shadow-xs"
          >
            Review Queue
          </button>
        </div>
      )}

      {/* ── KPI Metric Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div
          onClick={() => setAdminTab('pending')}
          className={`cursor-pointer rounded-2xl border p-5 shadow-xs transition ${
            adminTab === 'pending'
              ? 'border-amber-400 bg-amber-50/50 ring-2 ring-amber-400/20'
              : 'border-slate-200/80 bg-white hover:border-amber-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Pending Review</span>
            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-ping" />
          </div>
          <p className="mt-2 text-3xl font-extrabold text-amber-900">{summaryData?.pending ?? 0}</p>
          <p className="mt-1 text-xs text-amber-700">Requires manager decision</p>
        </div>

        <div
          onClick={() => { setAdminTab('all'); setStatusFilter('Approved') }}
          className="cursor-pointer rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs hover:border-emerald-200 transition"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Approved Leaves</span>
          <p className="mt-2 text-3xl font-extrabold text-slate-800">{summaryData?.approved ?? 0}</p>
          <p className="mt-1 text-xs text-emerald-600">Granted to date</p>
        </div>

        <div
          onClick={() => { setAdminTab('all'); setStatusFilter('Rejected') }}
          className="cursor-pointer rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs hover:border-rose-200 transition"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-rose-700">Rejected</span>
          <p className="mt-2 text-3xl font-extrabold text-slate-800">{summaryData?.rejected ?? 0}</p>
          <p className="mt-1 text-xs text-rose-600">Declined applications</p>
        </div>

        <div
          onClick={() => { setAdminTab('all'); setStatusFilter('All') }}
          className="cursor-pointer rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs hover:border-slate-300 transition"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Applications</span>
          <p className="mt-2 text-3xl font-extrabold text-slate-800">{summaryData?.total ?? 0}</p>
          <p className="mt-1 text-xs text-slate-400">All recorded leaves</p>
        </div>
      </div>

      {/* ── Admin Navigation Tabs ── */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setAdminTab('pending')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition ${
            adminTab === 'pending'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <HiOutlineClock className="h-4 w-4" />
          Pending Approvals Queue
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setAdminTab('all')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            adminTab === 'all'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <HiOutlineDocumentText className="h-4 w-4" />
          All Leave Applications
        </button>

        <button
          type="button"
          onClick={() => setAdminTab('summary')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            adminTab === 'summary'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <HiOutlineUserGroup className="h-4 w-4" />
          Company Leave Analytics
        </button>
      </div>

      {/* ── TAB 1: PENDING APPROVALS QUEUE (DIRECT ACTION BUTTONS) ── */}
      {adminTab === 'pending' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/40">
              <h2 className="text-sm font-bold text-slate-800">
                Pending Leave Queue ({pendingList.length})
              </h2>
              <span className="text-xs text-slate-400">Review employee requests and make a decision</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-200/80 bg-slate-50/60 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Employee</th>
                    <th className="px-4 py-3.5">Leave Type</th>
                    <th className="px-4 py-3.5">Period</th>
                    <th className="px-4 py-3.5">Days</th>
                    <th className="px-4 py-3.5">Reason</th>
                    <th className="px-5 py-3.5 text-right">Quick Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan="6" className="p-8 text-center text-slate-400">
                        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-2" />
                        <p>Loading pending requests...</p>
                      </td>
                    </tr>
                  ) : pendingList.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="p-12 text-center text-slate-400">
                        <HiOutlineCheckCircle className="mx-auto h-10 w-10 text-emerald-400 mb-2" />
                        <p className="font-bold text-slate-800 text-base">All Caught Up!</p>
                        <p className="text-xs text-slate-400 mt-1">
                          There are no pending leave requests waiting for approval right now.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    pendingList.map((row) => (
                      <tr key={row.leaveRequestId} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-4">
                          <p className="font-bold text-slate-900">{row.employeeName}</p>
                          <p className="text-xs text-slate-400">ID: {row.employeeCode || '—'}</p>
                        </td>
                        <td className="px-4 py-4 font-semibold text-slate-800">{row.leaveType}</td>
                        <td className="px-4 py-4 text-xs text-slate-600">
                          {formatCellDate(row.startDate, row.nepaliStartDate)} →{' '}
                          {formatCellDate(row.endDate, row.nepaliEndDate)}
                        </td>
                        <td className="px-4 py-4 font-bold text-slate-800">
                          {row.totalDays} {row.totalDays === 1 ? 'day' : 'days'}
                          {row.isHalfDay && (
                            <span className="block text-[10px] text-slate-400 font-normal">
                              ({row.halfDayPeriod})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-700 max-w-xs truncate" title={row.reason}>
                          {row.reason}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleQuickApprove(row)}
                              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition"
                            >
                              <HiOutlineCheck className="h-4 w-4" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickReject(row)}
                              className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
                            >
                              <HiOutlineXMark className="h-4 w-4" />
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: ALL LEAVE APPLICATIONS ── */}
      {adminTab === 'all' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
            <div className="relative flex-1 min-w-[240px]">
              <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by employee name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-4 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <span>From</span>
                <input
                  type="date"
                  value={fromFilter}
                  onChange={(e) => setFromFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-1 text-xs font-medium text-slate-700"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <span>To</span>
                <input
                  type="date"
                  value={toFilter}
                  onChange={(e) => setToFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-1 text-xs font-medium text-slate-700"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none"
              >
                <option value="All">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
                <option value="Draft">Draft</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none"
              >
                <option value="All">All Leave Types</option>
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-200/80 bg-slate-50/60 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Employee</th>
                    <th className="px-4 py-3.5">Type</th>
                    <th className="px-4 py-3.5">From</th>
                    <th className="px-4 py-3.5">To</th>
                    <th className="px-4 py-3.5">Days</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan="7" className="p-8 text-center text-slate-400">
                        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-2" />
                        <p>Loading all records...</p>
                      </td>
                    </tr>
                  ) : filteredAllList.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="p-10 text-center text-slate-400">
                        No records matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredAllList.map((row) => (
                      <tr key={row.leaveRequestId} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-3.5 font-bold text-slate-800">
                          {row.employeeName}
                          {row.employeeCode && (
                            <span className="ml-2 text-xs font-normal text-slate-400">({row.employeeCode})</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-medium text-slate-700">{row.leaveType}</td>
                        <td className="px-4 py-3.5 text-slate-600">{formatCellDate(row.startDate, row.nepaliStartDate)}</td>
                        <td className="px-4 py-3.5 text-slate-600">{formatCellDate(row.endDate, row.nepaliEndDate)}</td>
                        <td className="px-4 py-3.5 font-semibold text-slate-700">{row.totalDays}d</td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusBadge(row.status)}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="relative px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {row.canApprove && (
                              <button
                                type="button"
                                onClick={() => handleQuickApprove(row)}
                                className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition border border-emerald-200"
                              >
                                Approve
                              </button>
                            )}
                            {row.canReject && (
                              <button
                                type="button"
                                onClick={() => handleQuickReject(row)}
                                className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 transition border border-rose-200"
                              >
                                Reject
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setViewingItem(row)}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                            >
                              <HiOutlineEye className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: COMPANY LEAVE ANALYTICS ── */}
      {adminTab === 'summary' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
            <h2 className="text-base font-bold text-slate-800 mb-4">Approved Leaves Breakdown Across Company</h2>
            {summaryData?.byType && Object.keys(summaryData.byType).length > 0 ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(summaryData.byType).map(([typeName, count]) => (
                  <div key={typeName} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase">{typeName}</p>
                    <p className="mt-1.5 text-2xl font-bold text-indigo-700">
                      {count} <span className="text-sm font-normal text-slate-500">{count === 1 ? 'day' : 'days'}</span>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No approved leaves recorded across the organization.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Approve Modal ── */}
      {approvingItem && (
        <Modal title="Approve Leave Application" onClose={() => setApprovingItem(null)}>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-700">
              Confirm approval for <strong className="text-slate-900">{approvingItem.employeeName}</strong>?
            </p>
            <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
              <p>Type: <span className="font-semibold">{approvingItem.leaveType}</span></p>
              <p>Period: <span className="font-semibold">{approvingItem.startDate} → {approvingItem.endDate}</span> ({approvingItem.totalDays} days)</p>
              <p>Reason: <span className="italic">"{approvingItem.reason}"</span></p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Approval Remarks
              </label>
              <textarea
                rows="2"
                value={approveRemarks}
                onChange={(e) => setApproveRemarks(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-800 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setApprovingItem(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 shadow-xs"
              >
                Confirm Approval
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reject Modal ── */}
      {rejectingItem && (
        <Modal title="Decline Leave Application" onClose={() => setRejectingItem(null)}>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-700">
              Decline leave application from <strong className="text-slate-900">{rejectingItem.employeeName}</strong>?
            </p>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Reason for Rejection *
              </label>
              <textarea
                rows="2"
                placeholder="Explain why this request is declined..."
                value={rejectRemarks}
                onChange={(e) => setRejectRemarks(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-800 focus:border-rose-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRejectingItem(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 shadow-xs"
              >
                Decline Request
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── View Details Modal ── */}
      {viewingItem && (
        <LeaveDetailsModal item={viewingItem} onClose={() => setViewingItem(null)} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SHARED MODALS (Form & Details)
// ═══════════════════════════════════════════════════════════════════════════════

function LeaveFormModal({ title, form, setForm, submitting, formError, onClose, onSubmit }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="p-6 space-y-4">
        {formError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Leave Type *
            </label>
            <select
              value={form.leaveType}
              onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:border-sky-500 focus:outline-none"
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              From Date *
            </label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => {
                const newStart = e.target.value
                const bs = newStart ? adToBs(new Date(newStart)) : null
                setForm({
                  ...form,
                  startDate: newStart,
                  endDate: form.endDate < newStart ? newStart : form.endDate,
                  nepaliStartDate: bs?.dateBs || '',
                })
              }}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:border-sky-500 focus:outline-none"
            />
            {form.nepaliStartDate && (
              <p className="mt-1 text-[11px] text-slate-400">
                BS: <span className="font-semibold text-slate-600">{bsDmy(form.nepaliStartDate)}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              To Date *
            </label>
            <input
              type="date"
              value={form.endDate}
              min={form.startDate}
              onChange={(e) => {
                const newEnd = e.target.value
                const bs = newEnd ? adToBs(new Date(newEnd)) : null
                setForm({
                  ...form,
                  endDate: newEnd,
                  nepaliEndDate: bs?.dateBs || '',
                })
              }}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:border-sky-500 focus:outline-none"
            />
            {form.nepaliEndDate && (
              <p className="mt-1 text-[11px] text-slate-400">
                BS: <span className="font-semibold text-slate-600">{bsDmy(form.nepaliEndDate)}</span>
              </p>
            )}
          </div>

          <div className="sm:col-span-2 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div>
              <label className="text-xs font-bold text-slate-700">Half Day Leave</label>
              <p className="text-[11px] text-slate-400">Counts as 0.5 working days</p>
            </div>
            <input
              type="checkbox"
              checked={form.isHalfDay}
              onChange={(e) => setForm({ ...form, isHalfDay: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
          </div>

          {form.isHalfDay && (
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Half Day Period
              </label>
              <select
                value={form.halfDayPeriod}
                onChange={(e) => setForm({ ...form, halfDayPeriod: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:border-sky-500 focus:outline-none"
              >
                <option value="FirstHalf">First Half (Morning)</option>
                <option value="SecondHalf">Second Half (Afternoon)</option>
              </select>
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Reason / Description *
            </label>
            <textarea
              rows="3"
              placeholder="Explain why you need time off..."
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-800 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit(false)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
          >
            Save as Draft
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit(true)}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-sky-700 transition"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function LeaveDetailsModal({ item, onClose }) {
  return (
    <Modal title="Leave Request Details" onClose={onClose}>
      <div className="p-6 space-y-4 text-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <p className="font-bold text-slate-900 text-base">{item.employeeName}</p>
            {item.employeeCode && <p className="text-xs text-slate-400">ID: {item.employeeCode}</p>}
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${statusBadge(
              item.status
            )}`}
          >
            {item.status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-400 uppercase font-semibold">Type</span>
            <p className="font-bold text-slate-800 text-sm mt-0.5">{item.leaveType}</p>
          </div>
          <div>
            <span className="text-slate-400 uppercase font-semibold">Total Duration</span>
            <p className="font-bold text-slate-800 text-sm mt-0.5">
              {item.totalDays} {item.totalDays === 1 ? 'day' : 'days'}
              {item.isHalfDay && ` (${item.halfDayPeriod})`}
            </p>
          </div>
          <div>
            <span className="text-slate-400 uppercase font-semibold">Start Date</span>
            <p className="font-medium text-slate-700 mt-0.5">
              {dmy(item.startDate)} {item.nepaliStartDate ? `(${bsDmy(item.nepaliStartDate)} BS)` : ''}
            </p>
          </div>
          <div>
            <span className="text-slate-400 uppercase font-semibold">End Date</span>
            <p className="font-medium text-slate-700 mt-0.5">
              {dmy(item.endDate)} {item.nepaliEndDate ? `(${bsDmy(item.nepaliEndDate)} BS)` : ''}
            </p>
          </div>
        </div>

        <div>
          <span className="text-xs text-slate-400 uppercase font-semibold">Reason</span>
          <p className="mt-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 leading-relaxed font-medium">
            {item.reason}
          </p>
        </div>

        {item.decidedBy && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-xs">
            <p className="font-semibold text-slate-800">
              Decision by: <span className="text-sky-700">{item.decidedBy}</span> on {item.decidedDate}
            </p>
            {item.adminRemarks && (
              <p className="mt-1 text-slate-600">
                Remarks: <span className="font-medium text-slate-800">{item.adminRemarks}</span>
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
