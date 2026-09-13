import { useEffect, useState } from 'react'
import { reports } from '../api/resources'
import { apiErrorMessage } from '../lib/errors'
import { PageHeader, Card, Table, Field, Input, Button, ErrorText, Badge } from '../components/ui'
import { hm } from '../lib/dates'
import DayDetailModal from '../components/DayDetailModal'
import { useCalendar } from '../context/CalendarContext'
import DateToggle from '../components/DateToggle'
import NepaliDatePicker from '../components/NepaliDatePicker'
import ReportTabs from '../components/ReportTabs'

export default function DailyReport() {
  const { isBs } = useCalendar()
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [applied, setApplied] = useState(date)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    setLoading(true); setError('')
    reports.daily({ date: applied })
      .then(setData)
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [applied])

  const columns = [
    { key: 'employeeName', header: 'Employee', render: (r) => <span className="font-medium text-slate-800">{r.employeeName}</span> },
    { key: 'biometricUserId', header: 'ID' },
    { key: 'department', header: 'Department', render: (r) => r.department || '—' },
    { key: 'firstCheckIn', header: 'First check-in', render: (r) => r.firstCheckIn ? hm(r.firstCheckIn) : '—' },
    { key: 'lastCheckOut', header: 'Last check-out', render: (r) => r.lastCheckOut ? hm(r.lastCheckOut) : '—' },
    { key: 'totalWorkHoursFormatted', header: 'Hours', render: (r) => r.totalWorkHoursFormatted },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'Present' ? 'green' : r.status === 'Absent' ? 'red' : 'amber'}>{r.status}</Badge> },
    {
      key: 'logs', header: '', render: (r) => r.status === 'Absent' ? null : (
        <button
          onClick={() => setDetail({ employeeId: r.employeeId, employeeName: r.employeeName })}
          className="text-xs text-sky-600 hover:underline"
        >
          all check-ins / outs
        </button>
      ),
    },
  ]

  const subtitle = data
    ? isBs
      ? `${data.dateBs} BS`
      : `${data.dateAd} AD`
    : undefined

  return (
    <div>
      <PageHeader
        title="Daily Report"
        subtitle={subtitle}
        actions={<DateToggle />}
      />

      <ReportTabs />

      <Card className="mb-4 p-4">
        <form onSubmit={(e) => { e.preventDefault(); setApplied(date) }} className="flex items-end gap-3">
          <Field label="Date">
            <NepaliDatePicker value={date} onChange={(v) => setDate(v)} />
          </Field>
          <Button type="submit">Run</Button>
        </form>
      </Card>

      {error && <ErrorText>{error}</ErrorText>}

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Total', data.totalEmployees],
            ['Present', data.presentCount],
            ['Absent', data.absentCount],
            ['Rate', `${data.attendanceRate}%`],
          ].map(([l, v]) => (
            <Card key={l} className="p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-xl font-semibold">{v}</div></Card>
          ))}
        </div>
      )}

      <Table
        columns={columns}
        rows={(data?.items || []).map((r) => ({ ...r, _key: r.employeeId }))}
        loading={loading}
        empty="No data for this day."
      />

      {detail && (
        <DayDetailModal
          employeeId={detail.employeeId}
          employeeName={detail.employeeName}
          date={applied}
          dateBs={data?.dateBs}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}
