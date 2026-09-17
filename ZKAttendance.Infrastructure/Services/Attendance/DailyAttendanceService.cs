using Microsoft.EntityFrameworkCore;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Infrastructure.Services.Attendance
{
    /// <summary>
    /// End-of-day attendance processing.
    ///
    /// Called by the scheduled job and by the admin buttons alike. Nothing in
    /// here knows about scheduling, which is what stops the automatic and
    /// manual runs from drifting apart.
    /// </summary>
    public class DailyAttendanceService : IDailyAttendanceService
    {
        private readonly AttendanceDbContext _db;
        private readonly IAttendancePolicyService _policyService;
        private readonly INepaliCalendar _nepali;
        private readonly IEmailSender _email;
        private readonly ILogger<DailyAttendanceService> _logger;

        public DailyAttendanceService(
            AttendanceDbContext db,
            IAttendancePolicyService policyService,
            INepaliCalendar nepali,
            IEmailSender email,
            ILogger<DailyAttendanceService> logger)
        {
            _db = db;
            _policyService = policyService;
            _nepali = nepali;
            _email = email;
            _logger = logger;
        }

        /// <summary>One scan, with the terminal that recorded it.</summary>
        private sealed record PunchInfo(DateTime Time, string? DeviceName);

        // ── daily ───────────────────────────────────────────────────────

        public async Task<DailyAttendanceReport> BuildDailyReportAsync(
            DateTime date, int? departmentId = null, CancellationToken ct = default)
        {
            var day = date.Date;
            var policy = await _policyService.GetAsync(ct);

            var holiday = await _db.Holidays
                .FirstOrDefaultAsync(h => h.IsActive && h.HolidayDate.Date == day, ct);
            var isWeeklyOff = _nepali.IsWeeklyOff(day);
            var isNonWorking = holiday is not null || isWeeklyOff;

            // ── 1. START FROM THE EMPLOYEE LIST ─────────────────────────
            // The whole point of the report is the people who did NOT scan.
            // Driving off attendance records instead would silently drop them.
            var employeeQuery = _db.Employees
                .Include(e => e.Department)
                .Include(e => e.DefaultShift)
                .Where(e => e.IsActive && e.ApprovalStatus == "Approved");

            if (departmentId.HasValue)
                employeeQuery = employeeQuery.Where(e => e.DepartmentId == departmentId.Value);

            var employees = await employeeQuery
                .OrderBy(e => e.Department!.DepartmentName)
                .ThenBy(e => e.EmployeeName)
                .ToListAsync(ct);

            // ── 2. Attendance for the day, joined ON to that list ───────
            var logs = await _db.AttendanceLogs
                .Include(a => a.Device)
                .Where(a => a.AttendanceTime >= day && a.AttendanceTime < day.AddDays(1))
                .Select(a => new
                {
                    a.EmployeeId,
                    a.BiometricUserId,
                    a.AttendanceTime,
                    DeviceName = a.Device != null ? a.Device.DeviceName : null
                })
                .ToListAsync(ct);

            // A punch may arrive with no EmployeeId when nobody has claimed the
            // enrol number yet, so fall back to matching on the number itself.
            var byBiometric = employees
                .Where(e => !string.IsNullOrWhiteSpace(e.BiometricUserId))
                .GroupBy(e => e.BiometricUserId)
                .ToDictionary(g => g.Key, g => g.First().EmployeeId);

            var perEmployee = logs
                .Select(l => new
                {
                    EmployeeId = l.EmployeeId
                        ?? (byBiometric.TryGetValue(l.BiometricUserId, out var id) ? id : (int?)null),
                    l.AttendanceTime,
                    l.DeviceName
                })
                .Where(x => x.EmployeeId.HasValue)
                .GroupBy(x => x.EmployeeId!.Value)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderBy(x => x.AttendanceTime)
                          .Select(x => new PunchInfo(x.AttendanceTime, x.DeviceName))
                          .ToList());

            // Enrol numbers that punched but belong to nobody. Surfaced rather
            // than dropped, because that is a mapping the admin has to fix.
            var unmapped = logs
                .Where(l => l.EmployeeId is null && !byBiometric.ContainsKey(l.BiometricUserId))
                .Select(l => l.BiometricUserId)
                .Distinct()
                .OrderBy(x => x)
                .ToList();

            var approvals = await _db.AttendanceApprovals
                .Where(a => a.AttendanceDate == day)
                .ToDictionaryAsync(a => a.EmployeeId, a => a, ct);

            var report = new DailyAttendanceReport
            {
                Date = day,
                DateBs = _nepali.ToBsString(day),
                IsHoliday = isNonWorking,
                HolidayName = holiday?.HolidayName ?? (isWeeklyOff ? "Weekly off" : null),
                UnmappedDeviceIds = unmapped
            };

            foreach (var e in employees)
            {
                perEmployee.TryGetValue(e.EmployeeId, out var punches);
                var row = BuildRow(e, day, punches, policy, isNonWorking, report.HolidayName);

                if (approvals.TryGetValue(e.EmployeeId, out var approval))
                {
                    row.ApprovalStatus = approval.Status.ToString();
                    row.NeedsApproval = approval.Status == AttendanceApprovalStatus.Pending;
                }

                report.Rows.Add(row);
            }

            report.PresentCount = report.Rows.Count(r => r.Status == DailyAttendanceStatus.Present);
            report.LateCount = report.Rows.Count(r => r.Status == DailyAttendanceStatus.Late);
            report.PartialCount = report.Rows.Count(r => r.Status == DailyAttendanceStatus.Partial);
            report.AbsentCount = report.Rows.Count(r => r.Status == DailyAttendanceStatus.Absent);

            return report;
        }

        /// <summary>
        /// Turn one employee's punches into a status.
        ///
        ///   no punches, working day     Absent
        ///   no punches, holiday/off     Holiday
        ///   one punch                   Partial  (usually a missed check-out)
        ///   in within grace             Present
        ///   in after grace              Late
        /// </summary>
        private DailyAttendanceRow BuildRow(
            Employee e,
            DateTime day,
            List<PunchInfo>? punches,
            AttendancePolicy policy,
            bool isNonWorking,
            string? holidayName)
        {
            var row = new DailyAttendanceRow
            {
                EmployeeId = e.EmployeeId,
                EmployeeName = e.EmployeeName,
                DeviceUserId = e.BiometricUserId,
                DepartmentName = e.Department?.DepartmentName,
                Email = e.Email,
                Date = day,
                DateBs = _nepali.ToBsString(day)
            };

            var times = punches?.Select(p => p.Time).OrderBy(t => t).ToList()
                        ?? new List<DateTime>();
            row.Punches = times;

            if (times.Count > 0)
            {
                row.CheckIn = times.First();
                row.DeviceName = punches!.First().DeviceName;
                if (times.Count > 1) row.CheckOut = times.Last();
            }

            // Before they joined is not their absence to answer for.
            if (e.HireDate.HasValue && day < e.HireDate.Value.Date)
            {
                row.Status = DailyAttendanceStatus.NotJoined;
                return row;
            }

            if (times.Count == 0)
            {
                // A holiday with no scan is a holiday, not an absence.
                row.Status = isNonWorking ? DailyAttendanceStatus.Holiday : DailyAttendanceStatus.Absent;
                return row;
            }

            var effectivePolicy = policy;
            if (e.DefaultShift != null)
            {
                effectivePolicy = new AttendancePolicy
                {
                    OfficeStartTime = e.DefaultShift.StartTime,
                    OfficeEndTime = e.DefaultShift.EndTime,
                    GraceMinutes = e.DefaultShift.LateMinutes,
                    ApprovalRequiredAfterMinutes = policy.ApprovalRequiredAfterMinutes,
                    RequireApprovalForLate = policy.RequireApprovalForLate,
                    CloseGraceMinutes = e.DefaultShift.EarlyMinutes > 0 ? e.DefaultShift.EarlyMinutes : policy.CloseGraceMinutes,
                    HalfDayUnderHours = e.DefaultShift.MinHoursForFullDay > 0 ? e.DefaultShift.MinHoursForFullDay : policy.HalfDayUnderHours
                };
            }

            if (times.Count == 1)
            {
                // Scanned once. Almost always a forgotten check-out, so it is
                // Partial rather than Present: it needs a human to look at it.
                row.Status = DailyAttendanceStatus.Partial;
                row.MinutesLate = effectivePolicy.MinutesLate(row.CheckIn!.Value.TimeOfDay);
                return row;
            }

            row.WorkedHours = Math.Round((row.CheckOut!.Value - row.CheckIn!.Value).TotalHours, 2);
            row.MinutesLate = effectivePolicy.MinutesLate(row.CheckIn.Value.TimeOfDay);

            var outcome = effectivePolicy.Classify(row.CheckIn.Value.TimeOfDay);
            row.Status = outcome == ArrivalOutcome.OnTime
                ? DailyAttendanceStatus.Present
                : DailyAttendanceStatus.Late;

            return row;
        }

        // ── monthly cross-tab ───────────────────────────────────────────

        public async Task<MonthlyAttendanceReport> BuildMonthlyReportAsync(
            DateTime from, DateTime to, int? departmentId = null, CancellationToken ct = default)
        {
            var start = from.Date;
            var end = to.Date;
            if (end < start) (start, end) = (end, start);
            if ((end - start).TotalDays > 366)
                throw new InvalidOperationException("Range too wide. One year maximum.");

            var policy = await _policyService.GetAsync(ct);

            var holidays = (await _db.Holidays
                    .Where(h => h.IsActive && h.HolidayDate >= start && h.HolidayDate <= end)
                    .Select(h => h.HolidayDate)
                    .ToListAsync(ct))
                .Select(d => d.Date)
                .ToHashSet();

            var employeeQuery = _db.Employees
                .Include(e => e.Department)
                .Include(e => e.DefaultShift)
                .Where(e => e.IsActive && e.ApprovalStatus == "Approved");
            if (departmentId.HasValue)
                employeeQuery = employeeQuery.Where(e => e.DepartmentId == departmentId.Value);

            var employees = await employeeQuery
                .OrderBy(e => e.Department!.DepartmentName)
                .ThenBy(e => e.EmployeeName)
                .ToListAsync(ct);

            // One query for the whole range rather than one per day.
            var logs = await _db.AttendanceLogs
                .Where(a => a.AttendanceTime >= start && a.AttendanceTime < end.AddDays(1))
                .Select(a => new { a.EmployeeId, a.BiometricUserId, a.AttendanceTime })
                .ToListAsync(ct);

            var byBiometric = employees
                .Where(e => !string.IsNullOrWhiteSpace(e.BiometricUserId))
                .GroupBy(e => e.BiometricUserId)
                .ToDictionary(g => g.Key, g => g.First().EmployeeId);

            var grouped = logs
                .Select(l => new
                {
                    EmployeeId = l.EmployeeId
                        ?? (byBiometric.TryGetValue(l.BiometricUserId, out var id) ? id : (int?)null),
                    l.AttendanceTime
                })
                .Where(x => x.EmployeeId.HasValue)
                .GroupBy(x => (x.EmployeeId!.Value, x.AttendanceTime.Date))
                .ToDictionary(
                    g => g.Key,
                    g => g.Select(x => x.AttendanceTime).OrderBy(t => t).ToList());

            var report = new MonthlyAttendanceReport
            {
                From = start,
                To = end,
                FromBs = _nepali.ToBsString(start),
                ToBs = _nepali.ToBsString(end),
                HolidayDates = new HashSet<string>()
            };

            for (var d = start; d <= end; d = d.AddDays(1))
            {
                var key = d.ToString("yyyy-MM-dd");
                report.Dates.Add(key);
                if (holidays.Contains(d) || _nepali.IsWeeklyOff(d))
                    report.HolidayDates.Add(key);
                else
                    report.WorkingDays++;
            }

            var today = DateTime.Today;
            var now = DateTime.Now;
            var closeMoment = policy.DayClosesAt;

            foreach (var e in employees)
            {
                var row = new MonthlyAttendanceRow
                {
                    EmployeeId = e.EmployeeId,
                    EmployeeName = e.EmployeeName,
                    DepartmentName = e.Department?.DepartmentName,
                    DeviceUserId = e.BiometricUserId
                };

                var empPolicy = policy;
                if (e.DefaultShift != null)
                {
                    empPolicy = new AttendancePolicy
                    {
                        OfficeStartTime = e.DefaultShift.StartTime,
                        OfficeEndTime = e.DefaultShift.EndTime,
                        GraceMinutes = e.DefaultShift.LateMinutes,
                        ApprovalRequiredAfterMinutes = policy.ApprovalRequiredAfterMinutes,
                        RequireApprovalForLate = policy.RequireApprovalForLate,
                        CloseGraceMinutes = e.DefaultShift.EarlyMinutes > 0 ? e.DefaultShift.EarlyMinutes : policy.CloseGraceMinutes,
                        HalfDayUnderHours = e.DefaultShift.MinHoursForFullDay > 0 ? e.DefaultShift.MinHoursForFullDay : policy.HalfDayUnderHours
                    };
                }
                var empCloseMoment = empPolicy.DayClosesAt;

                for (var d = start; d <= end; d = d.AddDays(1))
                {
                    var key = d.ToString("yyyy-MM-dd");
                    var nonWorking = report.HolidayDates.Contains(key);

                    if (e.HireDate.HasValue && d < e.HireDate.Value.Date)
                    {
                        row.Marks[key] = "-";
                        continue;
                    }

                    grouped.TryGetValue((e.EmployeeId, d), out var times);

                    if (times is null || times.Count == 0)
                    {
                        if (nonWorking) { row.Marks[key] = "H"; continue; }

                        // A day that has not finished is not an absence.
                        var closed = d < today || (d == today && now.TimeOfDay >= empCloseMoment);
                        if (!closed) { row.Marks[key] = ""; continue; }

                        row.Marks[key] = "A";
                        row.TotalAbsent++;
                        continue;
                    }

                    if (times.Count == 1)
                    {
                        row.Marks[key] = "PT";
                        row.TotalPartial++;
                        continue;
                    }

                    var hours = (times.Last() - times.First()).TotalHours;
                    if (hours > 0) row.TotalHours += hours;

                    if (empPolicy.Classify(times.First().TimeOfDay) == ArrivalOutcome.OnTime)
                    {
                        row.Marks[key] = "P";
                        row.TotalPresent++;
                    }
                    else
                    {
                        row.Marks[key] = "L";
                        row.TotalLate++;
                    }
                }

                row.TotalHours = Math.Round(row.TotalHours, 1);
                report.Rows.Add(row);
            }

            return report;
        }

        // ── email ───────────────────────────────────────────────────────

        public async Task<EmailDispatchResult> SendEmployeeEmailsAsync(
            DateTime date, CancellationToken ct = default)
        {
            var result = new EmailDispatchResult();

            if (!await _email.IsConfiguredAsync(ct))
            {
                result.Errors.Add("Email is not configured. Add SMTP settings in Settings before sending.");
                return result;
            }

            var report = await BuildDailyReportAsync(date, null, ct);

            // Belt and braces. A unique index now prevents two employees from
            // sharing an address, but data predating it may still have some,
            // and sending Ram's check-in times to Sita is a privacy leak, not
            // a cosmetic bug. Skip both sides and say so rather than guess.
            var duplicateEmails = report.Rows
                .Where(r => !string.IsNullOrWhiteSpace(r.Email))
                .GroupBy(r => r.Email!.Trim().ToLowerInvariant())
                .Where(g => g.Count() > 1)
                .ToDictionary(g => g.Key, g => g.Select(r => r.EmployeeName).ToList());

            foreach (var (address, names) in duplicateEmails)
            {
                var message = $"{address} is shared by {string.Join(", ", names)}. " +
                              "No attendance email was sent to any of them. Give each person their own address.";
                result.Errors.Add(message);
                _logger.LogWarning("Skipped shared email address {Email} used by {Names}", address, string.Join(", ", names));
            }

            foreach (var row in report.Rows)
            {
                ct.ThrowIfCancellationRequested();

                if (!string.IsNullOrWhiteSpace(row.Email)
                    && duplicateEmails.ContainsKey(row.Email!.Trim().ToLowerInvariant()))
                {
                    result.Skipped++;
                    continue;
                }

                // Nothing useful to tell someone about a day they were not
                // expected in, and no address means nothing to send to.
                if (row.Status is DailyAttendanceStatus.Holiday or DailyAttendanceStatus.NotJoined
                    || string.IsNullOrWhiteSpace(row.Email))
                {
                    result.Skipped++;
                    continue;
                }

                try
                {
                    await _email.SendAsync(
                        row.Email!,
                        "Today's Attendance",
                        BuildEmployeeEmail(row),
                        ct);
                    result.Sent++;
                }
                catch (Exception ex)
                {
                    // One bad address must not stop the rest of the run.
                    result.Failed++;
                    result.Errors.Add($"{row.EmployeeName}: {ex.Message}");
                    _logger.LogWarning(ex, "Attendance email failed for {Employee}", row.EmployeeName);
                }
            }

            _logger.LogInformation(
                "Attendance emails for {Date}: {Sent} sent, {Skipped} skipped, {Failed} failed",
                date.ToString("dd/MM/yyyy"), result.Sent, result.Skipped, result.Failed);

            return result;
        }

        private static string BuildEmployeeEmail(DailyAttendanceRow row)
        {
            var time = (DateTime? t) => t.HasValue ? t.Value.ToString("hh:mm tt") : "Not recorded";

            var (headline, colour) = row.Status switch
            {
                DailyAttendanceStatus.Present => ("Present", "#059669"),
                DailyAttendanceStatus.Late => ("Late", "#d97706"),
                DailyAttendanceStatus.Partial => ("Partial", "#d97706"),
                _ => ("No Attendance", "#dc2626")
            };

            var closing = row.Status switch
            {
                DailyAttendanceStatus.Late =>
                    $"<p>You were {row.MinutesLate} minutes late today.</p>",
                DailyAttendanceStatus.Partial =>
                    "<p>Only one scan was recorded. Please check your attendance record.</p>",
                DailyAttendanceStatus.Absent =>
                    "<p>No attendance was recorded for you today. Please contact the administrator if this is incorrect.</p>",
                _ => "<p>Thank you.</p>"
            };

            var hours = row.WorkedHours > 0
                ? $"<tr><td style='padding:6px 0;color:#64748b'>Hours</td><td style='padding:6px 0;font-weight:600'>{row.WorkedHours:0.##}</td></tr>"
                : "";

            return $@"
<div style=""font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;color:#0f172a"">
  <p>Hello {System.Net.WebUtility.HtmlEncode(row.EmployeeName)},</p>
  <p>Your attendance for {row.Date:dd/MM/yyyy} ({row.DateBs} BS):</p>
  <table style=""width:100%;border-collapse:collapse;margin:16px 0"">
    <tr><td style=""padding:6px 0;color:#64748b"">Check-In</td><td style=""padding:6px 0;font-weight:600"">{time(row.CheckIn)}</td></tr>
    <tr><td style=""padding:6px 0;color:#64748b"">Check-Out</td><td style=""padding:6px 0;font-weight:600"">{time(row.CheckOut)}</td></tr>
    {hours}
    <tr><td style=""padding:6px 0;color:#64748b"">Status</td><td style=""padding:6px 0;font-weight:700;color:{colour}"">{headline}</td></tr>
  </table>
  {closing}
  <p style=""color:#94a3b8;font-size:12px"">This is an automated message from the attendance system.</p>
</div>";
        }

        public async Task<EmailDispatchResult> SendAdminSummaryAsync(
            DateTime date, CancellationToken ct = default)
        {
            var result = new EmailDispatchResult();

            if (!await _email.IsConfiguredAsync(ct))
            {
                result.Errors.Add("Email is not configured.");
                return result;
            }

            var recipients = await _db.ApiUsers
                .Where(u => u.IsActive && u.Role == "Admin" && u.Email != null)
                .Select(u => u.Email)
                .ToListAsync(ct);

            if (recipients.Count == 0)
            {
                result.Errors.Add("No active admin has an email address.");
                return result;
            }

            var report = await BuildDailyReportAsync(date, null, ct);
            var html = BuildAdminSummaryEmail(report);

            foreach (var to in recipients)
            {
                try
                {
                    await _email.SendAsync(to!, $"Attendance Summary {date:dd/MM/yyyy}", html, ct);
                    result.Sent++;
                }
                catch (Exception ex)
                {
                    result.Failed++;
                    result.Errors.Add($"{to}: {ex.Message}");
                }
            }

            return result;
        }

        private static string BuildAdminSummaryEmail(DailyAttendanceReport report)
        {
            var rows = string.Join("", report.Rows
                .Where(r => r.Status != DailyAttendanceStatus.NotJoined)
                .Select(r => $@"
    <tr>
      <td style=""padding:6px 8px;border-bottom:1px solid #e2e8f0"">{System.Net.WebUtility.HtmlEncode(r.EmployeeName)}</td>
      <td style=""padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#64748b"">{System.Net.WebUtility.HtmlEncode(r.DepartmentName ?? "")}</td>
      <td style=""padding:6px 8px;border-bottom:1px solid #e2e8f0"">{(r.CheckIn?.ToString("HH:mm") ?? "-")}</td>
      <td style=""padding:6px 8px;border-bottom:1px solid #e2e8f0"">{(r.CheckOut?.ToString("HH:mm") ?? "-")}</td>
      <td style=""padding:6px 8px;border-bottom:1px solid #e2e8f0;font-weight:600"">{r.StatusText}</td>
    </tr>"));

            var unmapped = report.UnmappedDeviceIds.Count == 0
                ? ""
                : $@"<p style=""color:#b45309"">Unmapped device IDs seen today: {string.Join(", ", report.UnmappedDeviceIds)}. These punches belong to nobody in the system.</p>";

            return $@"
<div style=""font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a"">
  <h2 style=""margin:0 0 4px"">Attendance Summary</h2>
  <p style=""margin:0 0 16px;color:#64748b"">{report.Date:dd/MM/yyyy} ({report.DateBs} BS)</p>
  <p>
    Present <b>{report.PresentCount}</b> &nbsp;
    Late <b>{report.LateCount}</b> &nbsp;
    Partial <b>{report.PartialCount}</b> &nbsp;
    Absent <b>{report.AbsentCount}</b> &nbsp;
    of <b>{report.TotalEmployees}</b>
  </p>
  {unmapped}
  <table style=""width:100%;border-collapse:collapse;font-size:14px;margin-top:12px"">
    <thead>
      <tr style=""text-align:left;background:#f8fafc"">
        <th style=""padding:8px"">Employee</th><th style=""padding:8px"">Department</th>
        <th style=""padding:8px"">In</th><th style=""padding:8px"">Out</th><th style=""padding:8px"">Status</th>
      </tr>
    </thead>
    <tbody>{rows}</tbody>
  </table>
</div>";
        }

        // ── the whole run ───────────────────────────────────────────────

        public async Task<DailyAttendanceReport> RunEndOfDayAsync(
            DateTime date, bool sendEmails = true, CancellationToken ct = default)
        {
            var day = date.Date;
            _logger.LogInformation("End-of-day run starting for {Date}", day.ToString("dd/MM/yyyy"));

            // Refresh the late-arrival queue first so the emails and the
            // summary reflect the same approval state the UI shows.
            try
            {
                await _policyService.EvaluateDayAsync(day, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Approval evaluation failed for {Date}; continuing", day);
            }

            var report = await BuildDailyReportAsync(day, null, ct);

            if (sendEmails)
            {
                var staff = await SendEmployeeEmailsAsync(day, ct);
                var admin = await SendAdminSummaryAsync(day, ct);

                _logger.LogInformation(
                    "End-of-day {Date}: {Present} present, {Late} late, {Partial} partial, {Absent} absent. " +
                    "Emails {Sent} sent, {Failed} failed. Admin summary {AdminSent} sent.",
                    day.ToString("dd/MM/yyyy"), report.PresentCount, report.LateCount,
                    report.PartialCount, report.AbsentCount, staff.Sent, staff.Failed, admin.Sent);
            }

            return report;
        }
    }
}
