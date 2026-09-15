using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ZKAttendance.Api.Security;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Application.Dtos;
using ZKAttendance.Application.Dtos.Api;
using ZKAttendance.Application.Services.Attendances;
using ZKAttendance.Infrastructure.Persistence;
using ZKAttendance.Infrastructure.Services.Attendances;
using ZKAttendance.Infrastructure.Services.Common;

namespace ZKAttendance.Api.Controllers
{
    /// <summary>
    /// The computed attendance log — punches grouped per employee-day with
    /// working hours and status. Ports Attendance/Index and Attendance/My.
    /// No business logic here: it calls the same query + calculation services
    /// the MVC screens used.
    /// </summary>
    [Route("api/Attendance")]
    [ApiController]
    [Produces("application/json")]
    [Tags("Attendance")]
    [Authorize]
    public class AttendanceLogApiController : ControllerBase
    {
        private readonly AttendanceDbContext _context;
        private readonly AttendanceQueryService _query;
        private readonly AttendanceCalculationService _calc;
        private readonly LookupService _lookups;
        private readonly IAttendancePolicyService _policyService;
        private readonly ILogger<AttendanceLogApiController> _logger;

        public AttendanceLogApiController(
            AttendanceDbContext context,
            AttendanceQueryService query,
            AttendanceCalculationService calc,
            LookupService lookups,
            IAttendancePolicyService policyService,
            ILogger<AttendanceLogApiController> logger)
        {
            _context = context;
            _query = query;
            _calc = calc;
            _lookups = lookups;
            _policyService = policyService;
            _logger = logger;
        }

        /// <summary>
        /// Upcoming and current-month holidays. Any authenticated user can call this;
        /// used by the Employee Dashboard holiday panel.
        /// </summary>
        [HttpGet("holidays/upcoming")]
        [ProducesResponseType(200)]
        public async Task<IActionResult> UpcomingHolidays([FromQuery] int days = 90)
        {
            var today = DateTime.Today;
            var monthStart = new DateTime(today.Year, today.Month, 1);
            var until = today.AddDays(days);

            var rows = await _context.Holidays.AsNoTracking()
                .Where(h => h.IsActive && (
                    (h.HolidayDate >= monthStart && h.HolidayDate < today) ||
                    (h.HolidayDate >= today && h.HolidayDate <= until)
                ))
                .OrderBy(h => h.HolidayDate)
                .Select(h => new
                {
                    h.HolidayId,
                    h.HolidayName,
                    date = h.HolidayDate,
                    h.HolidayType,
                    h.Description,
                    isPast = h.HolidayDate < today,
                    daysUntil = (int)(h.HolidayDate.Date - today).TotalDays
                })
                .ToListAsync();

            return Ok(rows);
        }

        /// <summary>
        /// Full attendance log, filtered and paged. Management only.
        /// </summary>
        /// <param name="search">Matches against the biometric id.</param>
        /// <param name="fromDate">Gregorian start date.</param>
        /// <param name="toDate">Gregorian end date.</param>
        /// <param name="branchId">Branch filter.</param>
        /// <param name="deviceId">Device filter.</param>
        /// <param name="status">"Full Day", "Check-in Only", …</param>
        /// <param name="minWorkHours">Minimum working hours.</param>
        /// <param name="maxWorkHours">Maximum working hours.</param>
        /// <param name="quickFilter">today | yesterday | thisweek | lastweek | thismonth | lastmonth | last7days | last30days</param>
        /// <param name="page">1-based page number. Page size is 50.</param>
        [HttpGet("log")]
        [Authorize(Roles = Roles.Management)]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Log(
            [FromQuery] string? search = null,
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int? branchId = null,
            [FromQuery] int? deviceId = null,
            [FromQuery] string? status = null,
            [FromQuery] int? minWorkHours = null,
            [FromQuery] int? maxWorkHours = null,
            [FromQuery] string? quickFilter = null,
            [FromQuery] int page = 1)
        {
            const int pageSize = 50;
            ApplyQuickFilter(quickFilter, ref fromDate, ref toDate);

            var logs = await _query.GetFilteredLogs(search, fromDate, toDate, branchId, deviceId);

            var employeeIds = logs.Where(l => l.EmployeeId.HasValue)
                .Select(l => l.EmployeeId!.Value).Distinct().ToList();
            var employees = await _query.GetEmployeesDictionary(employeeIds);
            var branches = await _query.GetBranchesDictionary(logs.Select(l => l.BranchId).Distinct().ToList());
            var devices = await _query.GetDevicesDictionary(logs.Select(l => l.DeviceId).Distinct().ToList());

            var rows = await _calc.BuildAttendanceViewModels(logs, employees, branches, devices);
            rows = ApplyExtraFilters(rows, status, minWorkHours, maxWorkHours);

            var ordered = rows
                .OrderByDescending(x => x.Date)
                .ThenBy(x => x.BiometricUserId)
                .ToList();

            var paged = ordered
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToList();

            return Ok(new
            {
                page,
                pageSize,
                totalRecords = ordered.Count,
                totalPages = (int)Math.Ceiling(ordered.Count / (double)pageSize),
                stats = new
                {
                    checkIns = ordered.Count(v => v.CheckInTime.HasValue),
                    checkOuts = ordered.Count(v => v.CheckOutTime.HasValue),
                    fullDay = ordered.Count(v => v.Status == "Full Day"),
                    checkInOnly = ordered.Count(v => v.Status == "Check-in Only"),
                    averageWorkHours = ordered.Where(v => v.WorkingHours > 0).Select(v => v.WorkingHours).DefaultIfEmpty(0).Average()
                },
                items = paged
            });
        }

        /// <summary>
        /// Raw individual punches (not grouped), newest first, paged. For the
        /// admin who needs to see and remove specific rows — test data, a
        /// double scan, a punch on the wrong device.
        /// </summary>
        /// <param name="onlyUnattributed">Only punches with no employee link.</param>
        /// <param name="onlyManual">Only punches entered by hand.</param>
        /// <param name="date">Restrict to one Gregorian day.</param>
        /// <param name="page">1-based; page size 100.</param>
        [HttpGet("punches")]
        [Authorize(Roles = Roles.Management)]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Punches(
            [FromQuery] bool onlyUnattributed = false,
            [FromQuery] bool onlyManual = false,
            [FromQuery] DateTime? date = null,
            [FromQuery] int page = 1)
        {
            const int pageSize = 100;
            var q = _context.AttendanceLogs.AsNoTracking()
                .Include(a => a.Device)
                .Include(a => a.Branch)
                .AsQueryable();

            if (onlyUnattributed) q = q.Where(a => a.EmployeeId == null);
            if (onlyManual) q = q.Where(a => a.IsManual);
            if (date is { } d) q = q.Where(a => a.AttendanceTime.Date == d.Date);

            var total = await q.CountAsync();
            var rows = await q
                .OrderByDescending(a => a.AttendanceTime)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(a => new
                {
                    a.LogId,
                    a.EmployeeId,
                    a.BiometricUserId,
                    a.AttendanceTime,
                    a.AttendanceType,
                    a.IsManual,
                    a.Notes,
                    device = a.Device != null ? a.Device.DeviceName : null,
                    branch = a.Branch != null ? a.Branch.BranchName : null
                })
                .ToListAsync();

            return Ok(new { page, pageSize, total, totalPages = (int)Math.Ceiling(total / (double)pageSize), items = rows });
        }

        /// <summary>Delete one punch by its LogId. Admin only.</summary>
        [HttpDelete("punches/{logId:long}")]
        [Authorize(Roles = Roles.Admin)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> DeletePunch(long logId)
        {
            var row = await _context.AttendanceLogs.FirstOrDefaultAsync(a => a.LogId == logId);
            if (row is null) return NotFound();

            _context.AttendanceLogs.Remove(row);
            await _context.SaveChangesAsync();
            _logger.LogInformation("Punch {LogId} deleted by {User}", logId, User.Identity?.Name);
            return NoContent();
        }

        /// <summary>
        /// Bulk-delete punches. Admin only. <paramref name="scope"/> is
        /// "unattributed" (EmployeeId is null — safe, never payroll data),
        /// "manual" (hand-entered rows), or "all" (everything in the range).
        /// Without <paramref name="from"/>/<paramref name="to"/> it covers all dates.
        /// </summary>
        [HttpPost("punches/purge")]
        [Authorize(Roles = Roles.Admin)]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> Purge(
            [FromQuery] string scope = "unattributed",
            [FromQuery] DateTime? from = null,
            [FromQuery] DateTime? to = null)
        {
            var q = _context.AttendanceLogs.AsQueryable();
            var wipeEverything = false;

            switch (scope.ToLowerInvariant())
            {
                case "unattributed": q = q.Where(a => a.EmployeeId == null); break;
                case "manual": q = q.Where(a => a.IsManual); break;
                case "all": wipeEverything = from is null && to is null; break;
                default:
                    return BadRequest(ApiError.From("scope must be 'unattributed', 'manual' or 'all'"));
            }

            if (from is { } f) q = q.Where(a => a.AttendanceTime >= f.Date);
            if (to is { } t) q = q.Where(a => a.AttendanceTime < t.Date.AddDays(1));

            var deleted = await q.ExecuteDeleteAsync();

            // "all" with no date bounds is a full reset — also clear the runtime
            // logs the dashboard reads (sync history, device errors/status).
            var syncLogs = 0;
            var deviceLogs = 0;
            if (wipeEverything)
            {
                syncLogs = await _context.SyncLogs.ExecuteDeleteAsync();
                deviceLogs = await _context.DeviceErrors.ExecuteDeleteAsync();
                await _context.DeviceStatuses.ExecuteDeleteAsync();
            }

            _logger.LogWarning("Purged {Count} punch(es) (scope={Scope}) by {User}", deleted, scope, User.Identity?.Name);
            return Ok(new { deleted, scope, syncLogsCleared = syncLogs, deviceErrorsCleared = deviceLogs });
        }

        /// <summary>
        /// Every individual punch for one employee on one day, in time order —
        /// the full trail behind a single "Present" cell, however many times
        /// they scanned in and out.
        /// </summary>
        [HttpGet("day")]
        [Authorize(Roles = Roles.Management)]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Day([FromQuery] int employeeId, [FromQuery] DateTime date)
        {
            var day = date.Date;
            var emp = await _context.Employees.AsNoTracking()
                .FirstOrDefaultAsync(e => e.EmployeeId == employeeId);
            if (emp is null) return NotFound(ApiError.From($"Employee {employeeId} not found"));

            var punches = await _context.AttendanceLogs.AsNoTracking()
                .Include(a => a.Device)
                .Include(a => a.Branch)
                .Where(a => a.EmployeeId == employeeId
                            && a.AttendanceTime >= day
                            && a.AttendanceTime < day.AddDays(1))
                .OrderBy(a => a.AttendanceTime)
                .Select(a => new
                {
                    a.LogId,
                    time = a.AttendanceTime,
                    a.AttendanceType,
                    a.VerifyMethod,
                    a.IsManual,
                    a.Notes,
                    device = a.Device != null ? a.Device.DeviceName : null,
                    branch = a.Branch != null ? a.Branch.BranchName : null
                })
                .ToListAsync();

            return Ok(new
            {
                employeeId,
                employeeName = emp.EmployeeName,
                dateAd = day.ToString("yyyy-MM-dd"),
                count = punches.Count,
                firstIn = punches.FirstOrDefault()?.time,
                lastOut = punches.Count > 1 ? punches.Last().time : (DateTime?)null,
                punches
            });
        }

        /// <summary>Filter option lists for the log screen.</summary>
        [HttpGet("log/filters")]
        [Authorize(Roles = Roles.Management)]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Filters()
        {
            var branches = await _lookups.GetActiveBranchesAsync();
            var devices = await _lookups.GetActiveDevicesAsync();
            return Ok(new
            {
                branches = branches.Select(b => new { b.BranchId, b.BranchName }),
                devices = devices.Select(d => new { d.DeviceId, d.DeviceName })
            });
        }

        /// <summary>
        /// The signed-in employee's own attendance. Any authenticated account;
        /// returns an empty list with <c>linked = false</c> when the account is
        /// not tied to an employee record.
        /// </summary>
        /// <param name="fromDate">Gregorian start. Defaults to 30 days before <paramref name="toDate"/>.</param>
        /// <param name="toDate">Gregorian end. Defaults to today.</param>
        /// <param name="quickFilter">Same values as the log endpoint.</param>
        [HttpGet("my")]
        [ProducesResponseType(200)]
        public async Task<IActionResult> My(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] string? quickFilter = null)
        {
            ApplyQuickFilter(quickFilter, ref fromDate, ref toDate);
            var to = toDate ?? DateTime.Today;
            var from = fromDate ?? to.AddDays(-30);

            var employeeId = await CurrentEmployeeIdAsync();
            if (employeeId is null)
                return Ok(new { linked = false, fromAd = from.ToString("yyyy-MM-dd"), toAd = to.ToString("yyyy-MM-dd"), totalDays = 0, totalHours = 0.0, items = Array.Empty<AttendanceViewModel>() });

            var logs = await _context.AttendanceLogs.AsNoTracking()
                .Where(a => a.EmployeeId == employeeId.Value
                            && a.AttendanceTime.Date >= from.Date
                            && a.AttendanceTime.Date <= to.Date)
                .ToListAsync();

            var employees = await _query.GetEmployeesDictionary(new List<int> { employeeId.Value });
            var branches = await _query.GetBranchesDictionary(logs.Select(l => l.BranchId).Distinct().ToList());
            var devices = await _query.GetDevicesDictionary(logs.Select(l => l.DeviceId).Distinct().ToList());

            var rows = (await _calc.BuildAttendanceViewModels(logs, employees, branches, devices))
                .OrderByDescending(v => v.Date)
                .ToList();

            return Ok(new
            {
                linked = true,
                fromAd = from.ToString("yyyy-MM-dd"),
                toAd = to.ToString("yyyy-MM-dd"),
                totalDays = rows.Count,
                totalHours = rows.Sum(v => v.WorkingHours),
                items = rows
            });
        }

        /// <summary>
        /// Attendance summary for the current month – the signed-in employee's
        /// own data. Returns presentDays, lateDays, totalHours, and the last 7
        /// attendance records so the User Dashboard can show warnings.
        /// </summary>
        [HttpGet("my-summary")]
        [ProducesResponseType(200)]
        public async Task<IActionResult> MySummary()
        {
            var today = DateTime.Today;
            var monthStart = new DateTime(today.Year, today.Month, 1);

            var employeeId = await CurrentEmployeeIdAsync();
            if (employeeId is null)
                return Ok(new { linked = false });

            // All logs for the current month
            var logs = await _context.AttendanceLogs.AsNoTracking()
                .Where(a => a.EmployeeId == employeeId.Value
                            && a.AttendanceTime.Date >= monthStart
                            && a.AttendanceTime.Date <= today)
                .ToListAsync();

            var employees = await _query.GetEmployeesDictionary(new List<int> { employeeId.Value });
            var branches = await _query.GetBranchesDictionary(logs.Select(l => l.BranchId).Distinct().ToList());
            var devices = await _query.GetDevicesDictionary(logs.Select(l => l.DeviceId).Distinct().ToList());

            var rows = (await _calc.BuildAttendanceViewModels(logs, employees, branches, devices))
                .OrderByDescending(v => v.Date)
                .ToList();

            // Late arrivals: check-in after office start + grace, using policy
            var policy = await _policyService.GetAsync();

            var officeStart = policy.OfficeStartTime;
            var graceMinutes = policy.GraceMinutes;
            var cutoff = officeStart.Add(TimeSpan.FromMinutes(graceMinutes));

            // Group raw logs to get first punch per day for late detection
            var firstPunches = logs
                .GroupBy(l => l.AttendanceTime.Date)
                .ToDictionary(g => g.Key, g => g.Min(l => l.AttendanceTime).TimeOfDay);

            var lateDays = firstPunches.Values.Count(t => t > cutoff);

            // Days with any attendance record
            var presentDays = rows.Count(r => r.CheckInTime.HasValue);
            var totalHours = rows.Sum(r => r.WorkingHours);

            var emp = await _context.Employees.AsNoTracking()
                .Include(e => e.Department)
                .FirstOrDefaultAsync(e => e.EmployeeId == employeeId.Value);

            // Calculate working days up to today (excluding Saturday)
            int workingDaysToDate = 0;
            for (var d = monthStart; d <= today; d = d.AddDays(1))
            {
                if (d.DayOfWeek != DayOfWeek.Saturday)
                    workingDaysToDate++;
            }

            // Recent 7 records for the table
            var recentLogs = rows.Take(7).Select(r => new
            {
                date = r.Date.ToString("yyyy-MM-dd"),
                nepaliDate = r.NepaliDate,
                checkIn = r.CheckInTime?.ToString("HH:mm"),
                checkOut = r.CheckOutTime?.ToString("HH:mm"),
                hours = Math.Round(r.WorkingHours, 2),
                status = r.Status,
                isLate = r.CheckInTime.HasValue && r.CheckInTime.Value.TimeOfDay > cutoff,
                minutesLate = r.CheckInTime.HasValue && r.CheckInTime.Value.TimeOfDay > cutoff
                    ? (int)Math.Ceiling((r.CheckInTime.Value.TimeOfDay - officeStart).TotalMinutes)
                    : 0
            });

            // All logs for the month ordered chronologically for trends
            var monthLogs = rows.OrderBy(r => r.Date).Select(r => new
            {
                date = r.Date.ToString("yyyy-MM-dd"),
                day = r.Date.Day,
                nepaliDate = r.NepaliDate,
                checkIn = r.CheckInTime?.ToString("HH:mm"),
                checkOut = r.CheckOutTime?.ToString("HH:mm"),
                hours = Math.Round(r.WorkingHours, 2),
                status = r.Status,
                isLate = r.CheckInTime.HasValue && r.CheckInTime.Value.TimeOfDay > cutoff,
                minutesLate = r.CheckInTime.HasValue && r.CheckInTime.Value.TimeOfDay > cutoff
                    ? (int)Math.Ceiling((r.CheckInTime.Value.TimeOfDay - officeStart).TotalMinutes)
                    : 0
            });

            // Today's status
            var todayRow = rows.FirstOrDefault(r => r.Date.Date == today);
            var todayStatus = todayRow != null
                ? new
                {
                    hasRecord = true,
                    checkIn = todayRow.CheckInTime?.ToString("HH:mm"),
                    checkOut = todayRow.CheckOutTime?.ToString("HH:mm"),
                    isLate = todayRow.CheckInTime.HasValue && todayRow.CheckInTime.Value.TimeOfDay > cutoff,
                    minutesLate = todayRow.CheckInTime.HasValue && todayRow.CheckInTime.Value.TimeOfDay > cutoff
                        ? (int)Math.Ceiling((todayRow.CheckInTime.Value.TimeOfDay - officeStart).TotalMinutes)
                        : 0,
                    status = todayRow.Status
                }
                : (object)new { hasRecord = false };

            return Ok(new
            {
                linked = true,
                employee = emp != null ? new
                {
                    id = emp.EmployeeId,
                    name = emp.EmployeeName,
                    title = emp.Title ?? "Employee",
                    department = emp.Department?.DepartmentName,
                    photoUrl = emp.PhotoUrl,
                    email = emp.Email,
                    biometricId = emp.BiometricUserId
                } : null,
                monthYear = today.ToString("yyyy-MM"),
                presentDays,
                lateDays,
                onTimeDays = Math.Max(0, presentDays - lateDays),
                workingDays = workingDaysToDate,
                attendanceRate = workingDaysToDate > 0
                    ? Math.Round((double)presentDays / workingDaysToDate * 100, 1)
                    : 100,
                avgWorkingHours = presentDays > 0
                    ? Math.Round(totalHours / presentDays, 1)
                    : 0,
                totalHours = Math.Round(totalHours, 1),
                today = todayStatus,
                recentLogs,
                monthLogs,
                officeStartTime = officeStart.ToString(@"hh\:mm"),
                graceMinutes
            });
        }

        private async Task<int?> CurrentEmployeeIdAsync()
        {
            if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var apiUserId))
                return null;

            return await _context.ApiUsers.AsNoTracking()
                .Where(u => u.ApiUserId == apiUserId)
                .Select(u => u.EmployeeId)
                .FirstOrDefaultAsync();
        }

        private static List<AttendanceViewModel> ApplyExtraFilters(
            List<AttendanceViewModel> list, string? status, int? min, int? max)
        {
            if (!string.IsNullOrEmpty(status))
                list = list.Where(v => v.Status == status).ToList();
            if (min.HasValue)
                list = list.Where(v => v.WorkingHours >= min.Value).ToList();
            if (max.HasValue)
                list = list.Where(v => v.WorkingHours <= max.Value).ToList();
            return list;
        }

        private static void ApplyQuickFilter(string? quickFilter, ref DateTime? fromDate, ref DateTime? toDate)
        {
            if (string.IsNullOrEmpty(quickFilter)) return;
            var today = DateTime.Today;

            switch (quickFilter.ToLowerInvariant())
            {
                case "today": fromDate = today; toDate = today; break;
                case "yesterday": fromDate = today.AddDays(-1); toDate = today.AddDays(-1); break;
                case "thisweek":
                    fromDate = today.AddDays(-(int)today.DayOfWeek); toDate = today; break;
                case "lastweek":
                    var lws = today.AddDays(-(int)today.DayOfWeek - 7);
                    fromDate = lws; toDate = lws.AddDays(6); break;
                case "thismonth":
                    fromDate = new DateTime(today.Year, today.Month, 1); toDate = today; break;
                case "lastmonth":
                    var lm = today.AddMonths(-1);
                    fromDate = new DateTime(lm.Year, lm.Month, 1);
                    toDate = new DateTime(lm.Year, lm.Month, DateTime.DaysInMonth(lm.Year, lm.Month)); break;
                case "last7days": fromDate = today.AddDays(-7); toDate = today; break;
                case "last30days": fromDate = today.AddDays(-30); toDate = today; break;
            }
        }
    }
}
