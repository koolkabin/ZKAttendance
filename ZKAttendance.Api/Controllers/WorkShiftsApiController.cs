using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using ZKAttendance.Api.Security;
using ZKAttendance.Application.Dtos.Api;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;
using ZKAttendance.Infrastructure.Services.Common;

namespace ZKAttendance.Api.Controllers
{
    /// <summary>
    /// Management of employee work shifts and individual shift assignments.
    /// Allows defining shift hours (start, end, grace minutes, break, overnight),
    /// and assigning or transferring employees to specific shifts.
    /// </summary>
    [Route("api/WorkShifts")]
    [ApiController]
    [Produces("application/json")]
    [Tags("WorkShifts")]
    [Authorize(Roles = Roles.Management)]
    public class WorkShiftsApiController : ControllerBase
    {
        private readonly AttendanceDbContext _db;
        private readonly LookupService _lookups;
        private readonly IMemoryCache _cache;
        private readonly ILogger<WorkShiftsApiController> _logger;

        public WorkShiftsApiController(
            AttendanceDbContext db,
            LookupService lookups,
            IMemoryCache cache,
            ILogger<WorkShiftsApiController> logger)
        {
            _db = db;
            _lookups = lookups;
            _cache = cache;
            _logger = logger;
        }

        /// <summary>
        /// List all work shifts with employee count and summary details.
        /// </summary>
        [HttpGet]
        [ProducesResponseType(200)]
        public async Task<IActionResult> GetAll([FromQuery] bool includeInactive = false)
        {
            var q = _db.WorkShifts.AsNoTracking();
            if (!includeInactive)
                q = q.Where(s => s.IsActive);

            var shifts = await q.OrderBy(s => s.StartTime).ToListAsync();

            // Count employees assigned to each shift
            var employeeCounts = await _db.Employees
                .Where(e => e.IsActive && e.DefaultShiftId != null)
                .GroupBy(e => e.DefaultShiftId!.Value)
                .Select(g => new { ShiftId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.ShiftId, x => x.Count);

            var result = shifts.Select(s => Shape(s, employeeCounts.GetValueOrDefault(s.ShiftId, 0)));
            return Ok(result);
        }

        /// <summary>
        /// Get a single work shift by ID with its assigned employees.
        /// </summary>
        [HttpGet("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> GetById(int id)
        {
            var shift = await _db.WorkShifts.AsNoTracking().FirstOrDefaultAsync(s => s.ShiftId == id);
            if (shift is null)
                return NotFound(ApiError.From($"Work shift {id} not found"));

            var employees = await _db.Employees
                .AsNoTracking()
                .Where(e => e.IsActive && e.DefaultShiftId == id)
                .Include(e => e.Department)
                .Select(e => new
                {
                    e.EmployeeId,
                    e.EmployeeName,
                    e.BiometricUserId,
                    e.Title,
                    departmentName = e.Department != null ? e.Department.DepartmentName : null,
                    e.Email
                })
                .ToListAsync();

            return Ok(new
            {
                shift = Shape(shift, employees.Count),
                employees
            });
        }

        /// <summary>
        /// Create a new work shift.
        /// </summary>
        [HttpPost]
        [ProducesResponseType(201)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> Create([FromBody] WorkShiftCreateRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.ShiftName))
                return BadRequest(ApiError.From("Shift name is required."));

            if (!TimeSpan.TryParse(request.StartTime, out var startTime))
                return BadRequest(ApiError.From("Valid StartTime (HH:mm) is required."));

            if (!TimeSpan.TryParse(request.EndTime, out var endTime))
                return BadRequest(ApiError.From("Valid EndTime (HH:mm) is required."));

            var isOvernight = request.IsOvernight || (endTime < startTime);

            // Compute work minutes
            int workMinutes;
            if (isOvernight)
            {
                var daySpan = TimeSpan.FromHours(24);
                workMinutes = (int)(daySpan - startTime + endTime).TotalMinutes;
            }
            else
            {
                workMinutes = (int)(endTime - startTime).TotalMinutes;
            }
            if (request.BreakMinutes > 0 && !request.IsBreakPaid)
            {
                workMinutes = Math.Max(0, workMinutes - request.BreakMinutes);
            }

            var shift = new WorkShift
            {
                ShiftName = request.ShiftName.Trim(),
                StartTime = startTime,
                EndTime = endTime,
                LateMinutes = request.LateMinutes >= 0 ? request.LateMinutes : 15,
                EarlyMinutes = request.EarlyMinutes >= 0 ? request.EarlyMinutes : 15,
                BreakMinutes = request.BreakMinutes >= 0 ? request.BreakMinutes : 0,
                IsBreakPaid = request.IsBreakPaid,
                IsOvernight = isOvernight,
                WorkMinutes = workMinutes > 0 ? workMinutes : 480,
                MinHoursForFullDay = request.MinHoursForFullDay > 0 ? request.MinHoursForFullDay : 4.0,
                Color = request.Color != 0 ? request.Color : 0x0284c7, // default sky blue
                Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                WorkDays = string.IsNullOrWhiteSpace(request.WorkDays) ? "0,1,2,3,4,5" : request.WorkDays.Trim(),
                IsActive = true,
                CreatedDate = DateTime.Now
            };

            _db.WorkShifts.Add(shift);
            await _db.SaveChangesAsync();
            _cache.Remove("active_shifts");

            _logger.LogInformation("Work shift '{Name}' ({Start:hh\\:mm} - {End:hh\\:mm}) created by {User}",
                shift.ShiftName, shift.StartTime, shift.EndTime, User.Identity?.Name);

            return StatusCode(201, Shape(shift, 0));
        }

        /// <summary>
        /// Update an existing work shift.
        /// </summary>
        [HttpPut("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 400)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Update(int id, [FromBody] WorkShiftCreateRequest request)
        {
            var shift = await _db.WorkShifts.FirstOrDefaultAsync(s => s.ShiftId == id);
            if (shift is null)
                return NotFound(ApiError.From($"Work shift {id} not found"));

            if (string.IsNullOrWhiteSpace(request.ShiftName))
                return BadRequest(ApiError.From("Shift name is required."));

            if (!TimeSpan.TryParse(request.StartTime, out var startTime))
                return BadRequest(ApiError.From("Valid StartTime (HH:mm) is required."));

            if (!TimeSpan.TryParse(request.EndTime, out var endTime))
                return BadRequest(ApiError.From("Valid EndTime (HH:mm) is required."));

            var isOvernight = request.IsOvernight || (endTime < startTime);
            int workMinutes;
            if (isOvernight)
            {
                var daySpan = TimeSpan.FromHours(24);
                workMinutes = (int)(daySpan - startTime + endTime).TotalMinutes;
            }
            else
            {
                workMinutes = (int)(endTime - startTime).TotalMinutes;
            }
            if (request.BreakMinutes > 0 && !request.IsBreakPaid)
            {
                workMinutes = Math.Max(0, workMinutes - request.BreakMinutes);
            }

            shift.ShiftName = request.ShiftName.Trim();
            shift.StartTime = startTime;
            shift.EndTime = endTime;
            shift.LateMinutes = request.LateMinutes >= 0 ? request.LateMinutes : 15;
            shift.EarlyMinutes = request.EarlyMinutes >= 0 ? request.EarlyMinutes : 15;
            shift.BreakMinutes = request.BreakMinutes >= 0 ? request.BreakMinutes : 0;
            shift.IsBreakPaid = request.IsBreakPaid;
            shift.IsOvernight = isOvernight;
            shift.WorkMinutes = workMinutes > 0 ? workMinutes : 480;
            shift.MinHoursForFullDay = request.MinHoursForFullDay > 0 ? request.MinHoursForFullDay : 4.0;
            if (request.Color != 0) shift.Color = request.Color;
            shift.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
            if (!string.IsNullOrWhiteSpace(request.WorkDays)) shift.WorkDays = request.WorkDays.Trim();
            shift.IsActive = request.IsActive;
            shift.ModifiedDate = DateTime.Now;

            await _db.SaveChangesAsync();
            _cache.Remove("active_shifts");

            var empCount = await _db.Employees.CountAsync(e => e.IsActive && e.DefaultShiftId == id);
            return Ok(Shape(shift, empCount));
        }

        /// <summary>
        /// Delete or deactivate a work shift.
        /// </summary>
        [HttpDelete("{id:int}")]
        [ProducesResponseType(204)]
        [ProducesResponseType(typeof(ApiError), 400)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Delete(int id)
        {
            var shift = await _db.WorkShifts.FirstOrDefaultAsync(s => s.ShiftId == id);
            if (shift is null)
                return NotFound(ApiError.From($"Work shift {id} not found"));

            var assignedCount = await _db.Employees.CountAsync(e => e.IsActive && e.DefaultShiftId == id);
            if (assignedCount > 0)
            {
                // Soft deactivate so historical logs aren't orphaned
                shift.IsActive = false;
                shift.ModifiedDate = DateTime.Now;
                await _db.SaveChangesAsync();
                _cache.Remove("active_shifts");
                return Ok(new { message = $"Shift deactivated because {assignedCount} employee(s) are assigned to it." });
            }

            _db.WorkShifts.Remove(shift);
            await _db.SaveChangesAsync();
            _cache.Remove("active_shifts");
            return NoContent();
        }

        /// <summary>
        /// Assign one or multiple employees to a specific work shift.
        /// </summary>
        [HttpPost("assign")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> AssignEmployees([FromBody] AssignShiftRequest request)
        {
            if (request.ShiftId <= 0)
                return BadRequest(ApiError.From("A valid ShiftId is required."));

            if (request.EmployeeIds is null || request.EmployeeIds.Count == 0)
                return BadRequest(ApiError.From("At least one employee must be selected."));

            var shift = await _db.WorkShifts.FirstOrDefaultAsync(s => s.ShiftId == request.ShiftId && s.IsActive);
            if (shift is null)
                return BadRequest(ApiError.From($"Active work shift {request.ShiftId} not found."));

            var targetEmployees = await _db.Employees
                .Where(e => request.EmployeeIds.Contains(e.EmployeeId))
                .ToListAsync();

            var effectiveDate = request.EffectiveFrom?.Date ?? DateTime.Today;

            foreach (var emp in targetEmployees)
            {
                emp.DefaultShiftId = shift.ShiftId;
                emp.ModifiedDate = DateTime.Now;

                // Also record in EmployeeShiftAssignments audit trail
                _db.EmployeeShiftAssignments.Add(new EmployeeShiftAssignment
                {
                    EmployeeId = emp.EmployeeId,
                    ShiftId = shift.ShiftId,
                    EffectiveFrom = effectiveDate,
                    Notes = request.Notes,
                    IsActive = true,
                    CreatedDate = DateTime.Now
                });
            }

            await _db.SaveChangesAsync();
            _cache.Remove("active_shifts");

            _logger.LogInformation("Assigned {Count} employee(s) to shift '{Shift}' by {User}",
                targetEmployees.Count, shift.ShiftName, User.Identity?.Name);

            return Ok(new
            {
                message = $"Successfully assigned {targetEmployees.Count} employee(s) to '{shift.ShiftName}'.",
                shiftId = shift.ShiftId,
                assignedCount = targetEmployees.Count
            });
        }

        /// <summary>
        /// Unassign employees from their custom shift (reverting them to company default office hours).
        /// </summary>
        [HttpPost("unassign")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> UnassignEmployees([FromBody] UnassignShiftRequest request)
        {
            if (request.EmployeeIds is null || request.EmployeeIds.Count == 0)
                return BadRequest(ApiError.From("At least one employee must be selected."));

            var targetEmployees = await _db.Employees
                .Where(e => request.EmployeeIds.Contains(e.EmployeeId))
                .ToListAsync();

            foreach (var emp in targetEmployees)
            {
                emp.DefaultShiftId = null;
                emp.ModifiedDate = DateTime.Now;
            }

            await _db.SaveChangesAsync();
            _cache.Remove("active_shifts");

            return Ok(new
            {
                message = $"Successfully reverted {targetEmployees.Count} employee(s) to default office hours.",
                unassignedCount = targetEmployees.Count
            });
        }

        private static object Shape(WorkShift s, int employeeCount = 0)
        {
            var start = s.StartTime.ToString(@"hh\:mm");
            var end = s.EndTime.ToString(@"hh\:mm");
            var hours = Math.Round(s.WorkMinutes / 60.0, 1);

            return new
            {
                shiftId = s.ShiftId,
                shiftName = s.ShiftName,
                startTime = start,
                endTime = end,
                timeDisplay = $"{start} - {end}",
                lateMinutes = s.LateMinutes,
                earlyMinutes = s.EarlyMinutes,
                breakMinutes = s.BreakMinutes,
                isBreakPaid = s.IsBreakPaid,
                isOvernight = s.IsOvernight,
                workMinutes = s.WorkMinutes,
                workHours = hours,
                minHoursForFullDay = s.MinHoursForFullDay,
                color = s.Color,
                description = s.Description,
                workDays = s.WorkDays,
                isActive = s.IsActive,
                employeeCount
            };
        }
    }

    public class WorkShiftCreateRequest
    {
        public string ShiftName { get; set; } = string.Empty;
        public string StartTime { get; set; } = "10:00";
        public string EndTime { get; set; } = "18:00";
        public int LateMinutes { get; set; } = 15;
        public int EarlyMinutes { get; set; } = 15;
        public int BreakMinutes { get; set; } = 0;
        public bool IsBreakPaid { get; set; } = true;
        public bool IsOvernight { get; set; } = false;
        public double MinHoursForFullDay { get; set; } = 4.0;
        public int Color { get; set; } = 0;
        public string? Description { get; set; }
        public string? WorkDays { get; set; }
        public bool IsActive { get; set; } = true;
    }

    public class AssignShiftRequest
    {
        public int ShiftId { get; set; }
        public List<int> EmployeeIds { get; set; } = new();
        public DateTime? EffectiveFrom { get; set; }
        public string? Notes { get; set; }
    }

    public class UnassignShiftRequest
    {
        public List<int> EmployeeIds { get; set; } = new();
    }
}
