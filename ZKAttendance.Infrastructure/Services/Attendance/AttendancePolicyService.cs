using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Infrastructure.Services.Attendance
{
    /// <summary>
    /// Stores the office-hours rules in SystemSettings as key/value pairs.
    ///
    /// Key/value rather than a dedicated table because there is exactly one row
    /// of settings, the table already exists, and adding a rule later needs no
    /// migration. The cache keeps the read off the hot path in the attendance
    /// grid, which asks for the policy once per request.
    /// </summary>
    public class AttendancePolicyService : IAttendancePolicyService
    {
        private const string Category = "Attendance";
        private const string CacheKey = "attendance_policy";

        private readonly AttendanceDbContext _db;
        private readonly IMemoryCache _cache;
        private readonly ILogger<AttendancePolicyService> _logger;

        public AttendancePolicyService(
            AttendanceDbContext db,
            IMemoryCache cache,
            ILogger<AttendancePolicyService> logger)
        {
            _db = db;
            _cache = cache;
            _logger = logger;
        }

        public async Task<AttendancePolicy> GetAsync(CancellationToken ct = default)
        {
            if (_cache.TryGetValue<AttendancePolicy>(CacheKey, out var cached) && cached is not null)
                return cached;

            var rows = await _db.SystemSettings
                .Where(s => s.Category == Category && s.IsActive)
                .ToDictionaryAsync(s => s.SettingKey, s => s.SettingValue, ct);

            var policy = new AttendancePolicy
            {
                OfficeStartTime = Time(rows, "OfficeStartTime", new TimeSpan(10, 0, 0)),
                OfficeEndTime = Time(rows, "OfficeEndTime", new TimeSpan(18, 0, 0)),
                GraceMinutes = Int(rows, "GraceMinutes", 15),
                ApprovalRequiredAfterMinutes = Int(rows, "ApprovalRequiredAfterMinutes", 60),
                RequireApprovalForLate = Bool(rows, "RequireApprovalForLate", false),
                CloseGraceMinutes = Int(rows, "CloseGraceMinutes", 30),
                HalfDayUnderHours = Dbl(rows, "HalfDayUnderHours", 4.0),
            };

            _cache.Set(CacheKey, policy, TimeSpan.FromMinutes(10));
            return policy;
        }

        public async Task<AttendancePolicy> SaveAsync(
            AttendancePolicy policy, string? changedBy = null, CancellationToken ct = default)
        {
            Validate(policy);

            var pairs = new Dictionary<string, string>
            {
                ["OfficeStartTime"] = policy.OfficeStartTime.ToString(@"hh\:mm"),
                ["OfficeEndTime"] = policy.OfficeEndTime.ToString(@"hh\:mm"),
                ["GraceMinutes"] = policy.GraceMinutes.ToString(),
                ["ApprovalRequiredAfterMinutes"] = policy.ApprovalRequiredAfterMinutes.ToString(),
                ["RequireApprovalForLate"] = policy.RequireApprovalForLate ? "true" : "false",
                ["CloseGraceMinutes"] = policy.CloseGraceMinutes.ToString(),
                ["HalfDayUnderHours"] = policy.HalfDayUnderHours.ToString("0.##"),
            };

            var existing = await _db.SystemSettings
                .Where(s => s.Category == Category)
                .ToListAsync(ct);

            foreach (var (key, value) in pairs)
            {
                var row = existing.FirstOrDefault(s => s.SettingKey == key);
                if (row is null)
                {
                    _db.SystemSettings.Add(new SystemSetting
                    {
                        SettingKey = key,
                        SettingValue = value,
                        Category = Category,
                        IsActive = true,
                        CreatedDate = DateTime.Now
                    });
                }
                else
                {
                    row.SettingValue = value;
                    row.IsActive = true;
                    row.ModifiedDate = DateTime.Now;
                }
            }

            await _db.SaveChangesAsync(ct);
            _cache.Remove(CacheKey);

            _logger.LogInformation(
                "Attendance policy updated by {User}: start {Start}, grace {Grace}m, approval after {Cutoff}m",
                changedBy ?? "system", policy.OfficeStartTime, policy.GraceMinutes,
                policy.ApprovalRequiredAfterMinutes);

            return policy;
        }

        /// <summary>
        /// Rules that would make the day nonsensical are rejected here rather
        /// than producing a schedule nobody can satisfy.
        /// </summary>
        private static void Validate(AttendancePolicy p)
        {
            if (p.OfficeEndTime <= p.OfficeStartTime)
                throw new InvalidOperationException("The office end time must be after the start time.");

            if (p.GraceMinutes is < 0 or > 240)
                throw new InvalidOperationException("Grace must be between 0 and 240 minutes.");

            if (p.ApprovalRequiredAfterMinutes < p.GraceMinutes)
                throw new InvalidOperationException(
                    "The approval cut-off cannot be earlier than the end of grace, or every late arrival would need approving twice.");

            if (p.OfficeStartTime.Add(TimeSpan.FromMinutes(p.ApprovalRequiredAfterMinutes)) >= p.OfficeEndTime)
                throw new InvalidOperationException("The approval cut-off must fall before the office end time.");

            if (p.CloseGraceMinutes is < 0 or > 720)
                throw new InvalidOperationException("Close grace must be between 0 and 720 minutes.");

            if (p.HalfDayUnderHours is < 0 or > 24)
                throw new InvalidOperationException("Half day hours must be between 0 and 24.");
        }

        public Task<int> EvaluateTodayAsync(CancellationToken ct = default)
            => EvaluateDayAsync(DateTime.Today, ct);

        public async Task<int> EvaluateDayAsync(DateTime date, CancellationToken ct = default)
        {
            var day = date.Date;
            var policy = await GetAsync(ct);

            // First scan per employee on this day.
            var firstScans = await _db.AttendanceLogs
                .Where(a => a.EmployeeId != null
                            && a.AttendanceTime >= day
                            && a.AttendanceTime < day.AddDays(1))
                .GroupBy(a => a.EmployeeId!.Value)
                .Select(g => new { EmployeeId = g.Key, First = g.Min(x => x.AttendanceTime) })
                .ToListAsync(ct);

            if (firstScans.Count == 0) return 0;

            var empIds = firstScans.Select(s => s.EmployeeId).Distinct().ToList();
            var empShifts = await _db.Employees.AsNoTracking()
                .Where(e => empIds.Contains(e.EmployeeId))
                .Include(e => e.DefaultShift)
                .ToDictionaryAsync(e => e.EmployeeId, e => e.DefaultShift, ct);

            var existing = await _db.AttendanceApprovals
                .Where(a => a.AttendanceDate == day)
                .ToListAsync(ct);

            var created = 0;

            foreach (var scan in firstScans)
            {
                var effectivePolicy = policy;
                if (empShifts.TryGetValue(scan.EmployeeId, out var shift) && shift != null)
                {
                    effectivePolicy = new AttendancePolicy
                    {
                        OfficeStartTime = shift.StartTime,
                        OfficeEndTime = shift.EndTime,
                        GraceMinutes = shift.LateMinutes,
                        ApprovalRequiredAfterMinutes = policy.ApprovalRequiredAfterMinutes,
                        RequireApprovalForLate = policy.RequireApprovalForLate,
                        CloseGraceMinutes = shift.EarlyMinutes > 0 ? shift.EarlyMinutes : policy.CloseGraceMinutes,
                        HalfDayUnderHours = shift.MinHoursForFullDay > 0 ? shift.MinHoursForFullDay : policy.HalfDayUnderHours
                    };
                }

                var outcome = effectivePolicy.Classify(scan.First.TimeOfDay);
                var row = existing.FirstOrDefault(a => a.EmployeeId == scan.EmployeeId);

                // Already decided by a person. Leave it alone: re-evaluating
                // would silently undo an admin's decision every sync.
                if (row is not null &&
                    row.Status is AttendanceApprovalStatus.Approved or AttendanceApprovalStatus.Rejected)
                    continue;

                var status = outcome == ArrivalOutcome.NeedsApproval
                    ? AttendanceApprovalStatus.Pending
                    : AttendanceApprovalStatus.AutoApproved;

                if (row is null)
                {
                    _db.AttendanceApprovals.Add(new AttendanceApproval
                    {
                        EmployeeId = scan.EmployeeId,
                        AttendanceDate = day,
                        Status = status,
                        FirstCheckIn = scan.First,
                        MinutesLate = effectivePolicy.MinutesLate(scan.First.TimeOfDay),
                        CreatedDate = DateTime.Now
                    });
                    if (status == AttendanceApprovalStatus.Pending) created++;
                }
                else
                {
                    // An earlier scan can arrive after the fact when a device
                    // has been offline, so keep the earliest and re-classify.
                    if (scan.First < (row.FirstCheckIn ?? DateTime.MaxValue))
                        row.FirstCheckIn = scan.First;

                    row.Status = status;
                    row.MinutesLate = effectivePolicy.MinutesLate((row.FirstCheckIn ?? scan.First).TimeOfDay);
                }
            }

            await _db.SaveChangesAsync(ct);

            if (created > 0)
                _logger.LogInformation("{Count} late arrival(s) on {Date} need approval", created, day.ToString("dd/MM/yyyy"));

            return created;
        }

        // ── parsing helpers ─────────────────────────────────────────

        private static TimeSpan Time(Dictionary<string, string> rows, string key, TimeSpan fallback) =>
            rows.TryGetValue(key, out var v) && TimeSpan.TryParse(v, out var t) ? t : fallback;

        private static int Int(Dictionary<string, string> rows, string key, int fallback) =>
            rows.TryGetValue(key, out var v) && int.TryParse(v, out var n) ? n : fallback;

        private static double Dbl(Dictionary<string, string> rows, string key, double fallback) =>
            rows.TryGetValue(key, out var v) && double.TryParse(v, out var n) ? n : fallback;

        private static bool Bool(Dictionary<string, string> rows, string key, bool fallback) =>
            rows.TryGetValue(key, out var v) ? v.Equals("true", StringComparison.OrdinalIgnoreCase) : fallback;
    }
}
