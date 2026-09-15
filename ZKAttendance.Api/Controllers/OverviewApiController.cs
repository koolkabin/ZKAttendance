using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ZKAttendance.Api.Security;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Api.Controllers
{
    /// <summary>
    /// The attendance overview / pivot: employees down the side, days across the
    /// top, one status per cell.
    ///
    /// WHEN A DAY COUNTS AS ABSENT
    /// ---------------------------
    /// Only once the day is CLOSED. A day is closed when it is in the past, or
    /// it is today and the shift end (plus a grace period) has already passed.
    /// Until then the cell reads "Upcoming", because somebody who has not yet
    /// arrived at 9am is not absent — and a day next week certainly is not.
    ///
    /// Days before the employee's hire date read "Not Joined" rather than
    /// absent, so a new joiner does not start life with a wall of red.
    ///
    /// First check-in and last check-out are the visible summary; every
    /// individual punch is still in the log and reachable through
    /// GET /api/Attendance/day.
    /// </summary>
    [Route("api/Overview")]
    [ApiController]
    [Produces("application/json")]
    [Tags("Overview")]
    [Authorize(Roles = Roles.Management)]
    public class OverviewApiController : ControllerBase
    {
        private readonly AttendanceDbContext _db;
        private readonly INepaliCalendar _nepali;
        private readonly IAttendancePolicyService _policy;

        public OverviewApiController(
            AttendanceDbContext db,
            INepaliCalendar nepali,
            IAttendancePolicyService policy)
        {
            _db = db;
            _nepali = nepali;
            _policy = policy;
        }

        /// <param name="from">Gregorian start date. Defaults to 6 days ago.</param>
        /// <param name="to">Gregorian end date. Defaults to today.</param>
        /// <param name="departmentId">Only employees in this department.</param>
        /// <param name="search">Match employee name or biometric id (contains).</param>
        /// <param name="employeeId">A single employee.</param>
        /// <param name="includeInactive">Include deactivated employees.</param>
        [HttpGet]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Get(
            [FromQuery] DateTime? from = null,
            [FromQuery] DateTime? to = null,
            [FromQuery] int? departmentId = null,
            [FromQuery] string? search = null,
            [FromQuery] int? employeeId = null,
            [FromQuery] bool includeInactive = false)
        {
            var start = (from ?? DateTime.Today.AddDays(-6)).Date;
            var end = (to ?? DateTime.Today).Date;
            if (end < start) (start, end) = (end, start);
            if ((end - start).TotalDays > 92)
                return BadRequest(new { message = "Range too wide — 92 days maximum." });

            var now = DateTime.Now;
            var today = now.Date;

            // Office hours come from Settings. An employee with a WorkShift
            // still uses that shift's own EndTime in preference.
            var policy = await _policy.GetAsync();
            var defaultCloseTime = policy.OfficeEndTime;
            var closeGraceMinutes = policy.CloseGraceMinutes;
            var halfDayUnderHours = policy.HalfDayUnderHours;

            // ── days + holidays ────────────────────────────────────────
            var holidayRows = await _db.Holidays
                .Where(h => h.IsActive && h.HolidayDate >= start && h.HolidayDate <= end)
                .ToListAsync();
            var holidayByDate = holidayRows
                .GroupBy(h => h.HolidayDate.Date)
                .ToDictionary(g => g.Key, g => g.First());

            var days = new List<DayCell>();
            for (var d = end; d >= start; d = d.AddDays(-1))
            {
                var weeklyOff = _nepali.IsWeeklyOff(d);
                var named = holidayByDate.TryGetValue(d, out var h);
                days.Add(new DayCell
                {
                    Date = d,
                    DateIso = d.ToString("yyyy-MM-dd"),
                    DateBs = _nepali.ToBsString(d),
                    Weekday = d.DayOfWeek.ToString()[..3],
                    IsHoliday = weeklyOff || named,
                    IsWeeklyOff = weeklyOff && !named,
                    IsFuture = d > today,
                    IsToday = d == today,
                    HolidayName = named ? h!.HolidayName : (weeklyOff ? "Weekly off" : null),
                    HolidayType = named ? h!.HolidayType : (weeklyOff ? "Weekly off" : null)
                });
            }

            // Every working day in the window, and the subset that has finished.
            var scheduledWorkingDays = days.Count(x => !x.IsHoliday);

            // ── employees ──────────────────────────────────────────────
            var empQuery = _db.Employees
                .Include(e => e.Department)
                .Include(e => e.EmployeeBranches).ThenInclude(eb => eb.Branch)
                .AsQueryable();

            if (!includeInactive) empQuery = empQuery.Where(e => e.IsActive);
            if (employeeId.HasValue) empQuery = empQuery.Where(e => e.EmployeeId == employeeId.Value);
            if (departmentId.HasValue) empQuery = empQuery.Where(e => e.DepartmentId == departmentId.Value);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim();
                empQuery = empQuery.Where(e => e.EmployeeName.Contains(s) || e.BiometricUserId.Contains(s));
            }

            var employees = await empQuery
                .OrderBy(e => e.EmployeeName)
                .ToListAsync();

            // Shift end times drive "has this working day finished for this person".
            var shiftIds = employees.Where(e => e.DefaultShiftId.HasValue)
                                    .Select(e => e.DefaultShiftId!.Value)
                                    .Distinct().ToList();
            var shifts = shiftIds.Count == 0
                ? new Dictionary<int, WorkShift>()
                : await _db.WorkShifts.Where(s => shiftIds.Contains(s.ShiftId))
                                      .ToDictionaryAsync(s => s.ShiftId);

            var empIds = employees.Select(e => e.EmployeeId).ToList();
            var biometricMap = employees
                .Where(e => !string.IsNullOrWhiteSpace(e.BiometricUserId))
                .GroupBy(e => e.BiometricUserId)
                .ToDictionary(g => g.Key, g => g.First().EmployeeId);

            // ── punches for the whole window, one query ─────────────────
            var logs = await _db.AttendanceLogs
                .Where(a => ((a.EmployeeId != null && empIds.Contains(a.EmployeeId!.Value))
                             || (a.EmployeeId == null && biometricMap.Keys.Contains(a.BiometricUserId)))
                            && a.AttendanceTime >= start
                            && a.AttendanceTime < end.AddDays(1))
                .Select(a => new { a.EmployeeId, a.BiometricUserId, a.AttendanceTime })
                .ToListAsync();

            var byEmpDay = logs
                .Select(a => new
                {
                    EmployeeId = a.EmployeeId ?? (biometricMap.TryGetValue(a.BiometricUserId, out var eid) ? eid : 0),
                    Day = a.AttendanceTime.Date,
                    a.AttendanceTime
                })
                .Where(x => x.EmployeeId != 0)
                .GroupBy(a => new { a.EmployeeId, a.Day })
                .ToDictionary(
                    g => (g.Key.EmployeeId, g.Key.Day),
                    g => g.Select(x => x.AttendanceTime).OrderBy(t => t).ToList());

            // ── build the grid ─────────────────────────────────────────
            var deptGroups = employees
                .GroupBy(e => new { Id = e.DepartmentId, Name = e.Department?.DepartmentName ?? "No department" })
                .OrderBy(g => g.Key.Name)
                .Select(g => new
                {
                    departmentId = g.Key.Id,
                    departmentName = g.Key.Name,
                    employees = g.Select(e =>
                    {
                        var cells = new Dictionary<string, object>();
                        int present = 0, absent = 0, halfDay = 0, upcoming = 0, closedWorkingDays = 0;
                        double totalHours = 0;
                        var hourSamples = new List<double>();

                        // When this person's working day ends.
                        var closeTime = e.DefaultShiftId is { } sid && shifts.TryGetValue(sid, out var sh)
                            ? sh.EndTime
                            : defaultCloseTime;
                        var closeMoment = closeTime.Add(TimeSpan.FromMinutes(closeGraceMinutes));

                        var hireDate = e.HireDate?.Date;

                        foreach (var day in days)
                        {
                            // 1. Before they joined — not their problem.
                            if (hireDate is { } hd && day.Date < hd)
                            {
                                cells[day.DateIso] = Cell("Not Joined");
                                continue;
                            }

                            // 2. Non-working day.
                            if (day.IsHoliday)
                            {
                                cells[day.DateIso] = Cell(day.IsWeeklyOff ? "Day Off" : "Holiday");
                                continue;
                            }

                            var hasPunches = byEmpDay.TryGetValue((e.EmployeeId, day.Date), out var times)
                                             && times.Count > 0;

                            // 3. Has the day finished for this employee?
                            var isClosed = day.Date < today
                                           || (day.Date == today && now.TimeOfDay >= closeMoment);

                            if (!hasPunches)
                            {
                                // THE FIX: an unfinished day is never absent.
                                if (!isClosed)
                                {
                                    cells[day.DateIso] = Cell("Upcoming");
                                    upcoming++;
                                    continue;
                                }

                                cells[day.DateIso] = Cell("Absent");
                                absent++;
                                closedWorkingDays++;
                                continue;
                            }

                            // 4. Present. First in / last out is the summary; the
                            //    punch count tells the UI there is more to see.
                            var firstIn = times!.First();
                            var lastOut = times.Count > 1 ? times.Last() : (DateTime?)null;
                            var hours = lastOut is { } lo ? Math.Round((lo - firstIn).TotalHours, 2) : 0.0;

                            var status = hours > 0 && hours < halfDayUnderHours ? "Half Day" : "Present";
                            if (status == "Half Day") halfDay++;
                            present++;
                            closedWorkingDays++;

                            if (hours > 0)
                            {
                                totalHours += hours;
                                hourSamples.Add(hours);
                            }

                            cells[day.DateIso] = new
                            {
                                status,
                                firstIn,
                                lastOut,
                                hours,
                                punchCount = times.Count,
                                isClosed
                            };
                        }

                        var branch = e.EmployeeBranches?.FirstOrDefault(b => b.IsActive)?.Branch?.BranchName
                                     ?? e.EmployeeBranches?.FirstOrDefault()?.Branch?.BranchName;

                        return new
                        {
                            e.EmployeeId,
                            e.EmployeeName,
                            e.BiometricUserId,
                            departmentId = e.DepartmentId,
                            departmentName = e.Department?.DepartmentName,
                            branchName = branch,
                            e.Title,
                            e.PhotoUrl,
                            hireDate = e.HireDate,
                            hireDateBs = e.HireDate.HasValue ? _nepali.ToBsString(e.HireDate.Value) : null,

                            // totalDays counts only days that have actually finished,
                            // so present + absent always reconciles with it.
                            totalDays = closedWorkingDays,
                            scheduledDays = scheduledWorkingDays,
                            presentDays = present,
                            absentDays = absent,
                            halfDays = halfDay,
                            upcomingDays = upcoming,

                            totalHours = Math.Round(totalHours, 2),
                            avgHours = hourSamples.Count > 0 ? Math.Round(hourSamples.Average(), 2) : 0.0,
                            cells
                        };
                    }).ToList()
                })
                .ToList();

            return Ok(new
            {
                fromAd = start.ToString("yyyy-MM-dd"),
                toAd = end.ToString("yyyy-MM-dd"),
                fromBs = _nepali.ToBsString(start),
                toBs = _nepali.ToBsString(end),
                workingDayCount = scheduledWorkingDays,
                days,
                employeeCount = employees.Count,
                departments = deptGroups
            });

            static object Cell(string status) => new
            {
                status,
                firstIn = (DateTime?)null,
                lastOut = (DateTime?)null,
                hours = 0.0,
                punchCount = 0,
                isClosed = status != "Upcoming"
            };
        }

        /// <summary>
        /// One row per employee for a whole period (a week, month or year):
        /// days present / absent, total and average hours, and the earliest
        /// check-in and latest check-out seen across the period. No per-day
        /// grid, so the range can be up to a year.
        ///
        /// Absent days are counted against working days that have FINISHED, so
        /// asking for "this month" halfway through the month does not report
        /// everybody as absent for the rest of it.
        /// </summary>
        /// <param name="from">Gregorian start. Defaults to the first of this month.</param>
        /// <param name="to">Gregorian end. Defaults to today.</param>
        /// <param name="departmentId">Only employees in this department.</param>
        [HttpGet("summary")]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Summary(
            [FromQuery] DateTime? from = null,
            [FromQuery] DateTime? to = null,
            [FromQuery] int? departmentId = null)
        {
            var now = DateTime.Now;
            var today = now.Date;
            var start = (from ?? new DateTime(today.Year, today.Month, 1)).Date;
            var end = (to ?? today).Date;
            if (end < start) (start, end) = (end, start);
            if (end > today) end = today;
            if (start > today) start = today;
            if ((end - start).TotalDays > 400)
                return BadRequest(new { message = "Range too wide — one year maximum." });

            var holidayDates = new HashSet<DateTime>(
                (await _db.Holidays
                    .Where(h => h.IsActive && h.HolidayDate >= start && h.HolidayDate <= end)
                    .Select(h => h.HolidayDate)
                    .ToListAsync())
                .Select(d => d.Date));

            var workingDays = new List<DateTime>();
            for (var d = start; d <= end; d = d.AddDays(1))
                if (!_nepali.IsWeeklyOff(d) && !holidayDates.Contains(d)) workingDays.Add(d);

            // If the range includes today and extends into the future (current month),
            // calculate working days up to today so future days are not reported as worked/scheduled yet.
            var isCurrentRange = start <= today && end > today;
            var workingDaysUpToToday = workingDays.Count(d => d <= today);
            var displayWorkingDays = isCurrentRange ? workingDaysUpToToday : workingDays.Count;

            var empQuery = _db.Employees.Include(e => e.Department).Where(e => e.IsActive);
            if (departmentId.HasValue) empQuery = empQuery.Where(e => e.DepartmentId == departmentId.Value);
            var employees = await empQuery.OrderBy(e => e.EmployeeName).ToListAsync();
            var empIds = employees.Select(e => e.EmployeeId).ToList();

            // Same office-hours rules as the grid, so the two never disagree.
            var policy = await _policy.GetAsync();
            var defaultCloseTime = policy.OfficeEndTime;
            var closeGraceMinutes = policy.CloseGraceMinutes;

            var shiftIds = employees.Where(e => e.DefaultShiftId.HasValue)
                                    .Select(e => e.DefaultShiftId!.Value).Distinct().ToList();
            var shifts = shiftIds.Count == 0
                ? new Dictionary<int, WorkShift>()
                : await _db.WorkShifts.Where(s => shiftIds.Contains(s.ShiftId)).ToDictionaryAsync(s => s.ShiftId);

            var logs = await _db.AttendanceLogs
                .Where(a => a.EmployeeId != null
                            && empIds.Contains(a.EmployeeId!.Value)
                            && a.AttendanceTime >= start
                            && a.AttendanceTime < end.AddDays(1))
                .Select(a => new { EmployeeId = a.EmployeeId!.Value, a.AttendanceTime })
                .ToListAsync();

            var perEmpDay = logs
                .GroupBy(a => new { a.EmployeeId, Day = a.AttendanceTime.Date })
                .Select(g => new
                {
                    g.Key.EmployeeId,
                    g.Key.Day,
                    First = g.Min(x => x.AttendanceTime),
                    Last = g.Count() > 1 ? g.Max(x => x.AttendanceTime) : (DateTime?)null
                })
                .ToList();

            static string? Hm(TimeSpan? t) => t is { } v ? $"{(int)v.TotalHours:D2}:{v.Minutes:D2}" : null;

            var deptGroups = employees
                .GroupBy(e => new { Id = e.DepartmentId, Name = e.Department?.DepartmentName ?? "No department" })
                .OrderBy(g => g.Key.Name)
                .Select(g => new
                {
                    departmentId = g.Key.Id,
                    departmentName = g.Key.Name,
                    employees = g.Select(e =>
                    {
                        var closeTime = e.DefaultShiftId is { } sid && shifts.TryGetValue(sid, out var sh)
                            ? sh.EndTime
                            : defaultCloseTime;
                        var closeMoment = closeTime.Add(TimeSpan.FromMinutes(closeGraceMinutes));
                        var hireDate = e.HireDate?.Date;

                        var mine = perEmpDay.Where(x => x.EmployeeId == e.EmployeeId).ToList();
                        var present = mine.Count;

                        // Working days that have finished AND fall after they joined.
                        // If current month, cap at working days up to today.
                        var elapsed = workingDays.Count(d =>
                            (hireDate is null || d >= hireDate)
                            && (d < today || (d == today && (now.TimeOfDay >= closeMoment || mine.Any(p => p.Day == today)))));

                        var dayHours = mine
                            .Where(x => x.Last is not null)
                            .Select(x => Math.Round((x.Last!.Value - x.First).TotalHours, 2))
                            .Where(h => h > 0)
                            .ToList();

                        var ins = mine.Select(x => x.First.TimeOfDay).ToList();
                        var outs = mine.Where(x => x.Last is not null).Select(x => x.Last!.Value.TimeOfDay).ToList();

                        return new
                        {
                            e.EmployeeId,
                            e.EmployeeName,
                            e.BiometricUserId,
                            departmentId = e.DepartmentId,
                            departmentName = e.Department?.DepartmentName,
                            presentDays = present,
                            absentDays = Math.Max(0, elapsed - present),
                            workingDaysElapsed = elapsed,
                            workingDaysScheduled = isCurrentRange ? workingDaysUpToToday : workingDays.Count,
                            totalHours = Math.Round(dayHours.Sum(), 1),
                            avgHours = dayHours.Count > 0 ? Math.Round(dayHours.Average(), 2) : 0.0,
                            earliestIn = Hm(ins.Count > 0 ? ins.Min() : null),
                            latestOut = Hm(outs.Count > 0 ? outs.Max() : null),
                            avgIn = Hm(ins.Count > 0 ? TimeSpan.FromTicks((long)ins.Average(t => t.Ticks)) : null),
                            avgOut = Hm(outs.Count > 0 ? TimeSpan.FromTicks((long)outs.Average(t => t.Ticks)) : null)
                        };
                    }).ToList()
                })
                .ToList();

            return Ok(new
            {
                fromAd = start.ToString("yyyy-MM-dd"),
                toAd = end.ToString("yyyy-MM-dd"),
                fromBs = _nepali.ToBsString(start),
                toBs = _nepali.ToBsString(end),
                workingDays = displayWorkingDays,
                workingDaysTotal = workingDays.Count,
                workingDaysUpToToday = workingDaysUpToToday,
                isCurrentMonth = isCurrentRange,
                employeeCount = employees.Count,
                departments = deptGroups
            });
        }

        private sealed class DayCell
        {
            public DateTime Date { get; set; }
            public string DateIso { get; set; } = "";
            public string DateBs { get; set; } = "";
            public string Weekday { get; set; } = "";
            public bool IsHoliday { get; set; }
            public bool IsWeeklyOff { get; set; }
            public bool IsFuture { get; set; }
            public bool IsToday { get; set; }
            public string? HolidayName { get; set; }
            public string? HolidayType { get; set; }
        }
    }
}
