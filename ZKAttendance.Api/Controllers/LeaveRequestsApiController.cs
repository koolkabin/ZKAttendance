using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Api.Controllers
{
    [ApiController]
    [Route("api/LeaveRequests")]
    [Route("api/[controller]")]
    [Authorize]
    public class LeaveRequestsApiController : ControllerBase
    {
        private readonly AttendanceDbContext _context;

        public LeaveRequestsApiController(AttendanceDbContext context)
        {
            _context = context;
        }

        private int? CurrentUserId =>
            int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

        private async Task<int?> CurrentEmployeeIdAsync()
        {
            var userId = CurrentUserId;
            if (userId is null) return null;

            var empId = await _context.ApiUsers.AsNoTracking()
                .Where(u => u.ApiUserId == userId.Value)
                .Select(u => u.EmployeeId)
                .FirstOrDefaultAsync();

            if (empId.HasValue && empId.Value > 0) return empId;

            // Fallback: match by username in Employees
            var userName = CurrentUserName;
            if (!string.IsNullOrWhiteSpace(userName))
            {
                var matched = await _context.Employees.AsNoTracking()
                    .Where(e => e.EmployeeName == userName || e.BiometricUserId == userName || (e.Email != null && e.Email == userName))
                    .Select(e => (int?)e.EmployeeId)
                    .FirstOrDefaultAsync();
                if (matched.HasValue) return matched;
            }

            // Fallback for development/admin/unlinked test accounts: use first employee
            return await _context.Employees.AsNoTracking()
                .OrderBy(e => e.EmployeeId)
                .Select(e => (int?)e.EmployeeId)
                .FirstOrDefaultAsync();
        }

        private async Task<bool> CheckIsManagerAsync()
        {
            if (User.IsInRole("Admin") || User.IsInRole("HR") ||
                User.HasClaim(c => (c.Type == ClaimTypes.Role || c.Type == "role" || c.Type.EndsWith("/role")) &&
                                   (c.Value.Equals("Admin", StringComparison.OrdinalIgnoreCase) ||
                                    c.Value.Equals("HR", StringComparison.OrdinalIgnoreCase))))
            {
                return true;
            }

            var userId = CurrentUserId;
            if (userId.HasValue)
            {
                var role = await _context.ApiUsers.AsNoTracking()
                    .Where(u => u.ApiUserId == userId.Value)
                    .Select(u => u.Role)
                    .FirstOrDefaultAsync();

                if (!string.IsNullOrEmpty(role) &&
                    (role.Equals("Admin", StringComparison.OrdinalIgnoreCase) ||
                     role.Equals("HR", StringComparison.OrdinalIgnoreCase)))
                {
                    return true;
                }
            }

            return false;
        }

        private string CurrentUserName =>
            User.Identity?.Name ?? User.FindFirstValue(ClaimTypes.Name) ?? "Admin";

        // ── GET api/LeaveRequests ──────────────────────────────────────────────
        [HttpGet]
        [ProducesResponseType(200)]
        public async Task<IActionResult> List(
            [FromQuery] string? search,
            [FromQuery] string? status,
            [FromQuery] string? type,
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] int? employeeId)
        {
            var myEmpId = await CurrentEmployeeIdAsync();
            var isMgr = await CheckIsManagerAsync();

            var query = _context.LeaveRequests
                .AsNoTracking()
                .Include(r => r.Employee)
                .AsQueryable();

            // Permissions: Regular employee can only see their own requests
            if (!isMgr)
            {
                if (myEmpId is null)
                    return Ok(new List<object>());

                query = query.Where(r => r.EmployeeId == myEmpId.Value);
            }
            else if (employeeId.HasValue)
            {
                query = query.Where(r => r.EmployeeId == employeeId.Value);
            }

            // Status filter
            if (!string.IsNullOrWhiteSpace(status) && !status.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                if (Enum.TryParse<LeaveRequestStatus>(status, true, out var parsedStatus))
                {
                    query = query.Where(r => r.Status == parsedStatus);
                }
            }

            // Leave type filter
            if (!string.IsNullOrWhiteSpace(type) && !type.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                query = query.Where(r => r.LeaveType == type);
            }

            // Date range filter
            if (from.HasValue)
            {
                var fromDate = from.Value.Date;
                query = query.Where(r => r.EndDate >= fromDate);
            }
            if (to.HasValue)
            {
                var toDate = to.Value.Date;
                query = query.Where(r => r.StartDate <= toDate);
            }

            // Search filter (employee name or reason)
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim();
                query = query.Where(r => (r.Employee != null && r.Employee.EmployeeName.Contains(term))
                                      || r.Reason.Contains(term)
                                      || (r.NepaliStartDate != null && r.NepaliStartDate.Contains(term))
                                      || (r.NepaliEndDate != null && r.NepaliEndDate.Contains(term)));
            }

            var rows = await query
                .OrderByDescending(r => r.CreatedDate)
                .Select(r => new
                {
                    r.LeaveRequestId,
                    r.EmployeeId,
                    employeeName = r.Employee != null ? r.Employee.EmployeeName : "Unknown",
                    employeeCode = r.Employee != null ? r.Employee.BiometricUserId : "",
                    r.LeaveType,
                    startDate = r.StartDate.ToString("yyyy-MM-dd"),
                    endDate = r.EndDate.ToString("yyyy-MM-dd"),
                    r.NepaliStartDate,
                    r.NepaliEndDate,
                    r.TotalDays,
                    r.IsHalfDay,
                    r.HalfDayPeriod,
                    r.Reason,
                    status = r.Status.ToString(),
                    createdDate = r.CreatedDate.ToString("yyyy-MM-dd HH:mm"),
                    submittedDate = r.SubmittedDate.HasValue ? r.SubmittedDate.Value.ToString("yyyy-MM-dd HH:mm") : null,
                    decidedDate = r.DecidedDate.HasValue ? r.DecidedDate.Value.ToString("yyyy-MM-dd HH:mm") : null,
                    r.DecidedBy,
                    r.AdminRemarks,
                    canEdit = (r.Status == LeaveRequestStatus.Draft || r.Status == LeaveRequestStatus.Pending) && (r.EmployeeId == myEmpId || isMgr),
                    canDelete = (r.Status == LeaveRequestStatus.Draft || r.Status == LeaveRequestStatus.Pending) && (r.EmployeeId == myEmpId || isMgr),
                    canSubmit = r.Status == LeaveRequestStatus.Draft && (r.EmployeeId == myEmpId || isMgr),
                    canApprove = isMgr && r.Status == LeaveRequestStatus.Pending,
                    canReject = isMgr && r.Status == LeaveRequestStatus.Pending
                })
                .ToListAsync();

            return Ok(rows);
        }

        // ── GET api/LeaveRequests/{id} ─────────────────────────────────────────
        [HttpGet("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> GetById(int id)
        {
            var myEmpId = await CurrentEmployeeIdAsync();
            var isMgr = await CheckIsManagerAsync();

            var r = await _context.LeaveRequests
                .AsNoTracking()
                .Include(req => req.Employee)
                .FirstOrDefaultAsync(req => req.LeaveRequestId == id);

            if (r is null) return NotFound(new { message = "Leave request not found." });

            if (!isMgr && r.EmployeeId != myEmpId)
                return Forbid();

            return Ok(new
            {
                r.LeaveRequestId,
                r.EmployeeId,
                employeeName = r.Employee?.EmployeeName,
                employeeCode = r.Employee?.BiometricUserId,
                r.LeaveType,
                startDate = r.StartDate.ToString("yyyy-MM-dd"),
                endDate = r.EndDate.ToString("yyyy-MM-dd"),
                r.NepaliStartDate,
                r.NepaliEndDate,
                r.TotalDays,
                r.IsHalfDay,
                r.HalfDayPeriod,
                r.Reason,
                status = r.Status.ToString(),
                createdDate = r.CreatedDate.ToString("yyyy-MM-dd HH:mm"),
                submittedDate = r.SubmittedDate.HasValue ? r.SubmittedDate.Value.ToString("yyyy-MM-dd HH:mm") : null,
                decidedDate = r.DecidedDate.HasValue ? r.DecidedDate.Value.ToString("yyyy-MM-dd HH:mm") : null,
                r.DecidedBy,
                r.AdminRemarks
            });
        }

        // ── POST api/LeaveRequests ────────────────────────────────────────────
        [HttpPost]
        [ProducesResponseType(201)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> Create([FromBody] LeaveRequestInputDto dto)
        {
            if (dto is null) return BadRequest(new { message = "Payload required." });

            var myEmpId = await CurrentEmployeeIdAsync();
            var isMgr = await CheckIsManagerAsync();
            var targetEmpId = (isMgr && dto.EmployeeId.HasValue) ? dto.EmployeeId.Value : myEmpId;

            if (targetEmpId is null)
                return BadRequest(new { message = "Your account is not linked to an employee profile." });

            if (dto.StartDate.Date > dto.EndDate.Date)
                return BadRequest(new { message = "Start date cannot be after end date." });

            decimal totalDays = dto.IsHalfDay ? 0.5m : Math.Max(1.0m, (decimal)(dto.EndDate.Date - dto.StartDate.Date).TotalDays + 1);

            var status = dto.Submit ? LeaveRequestStatus.Pending : LeaveRequestStatus.Draft;

            var entity = new LeaveRequest
            {
                EmployeeId = targetEmpId.Value,
                LeaveType = string.IsNullOrWhiteSpace(dto.LeaveType) ? "Other" : dto.LeaveType,
                StartDate = dto.StartDate.Date,
                EndDate = dto.EndDate.Date,
                NepaliStartDate = dto.NepaliStartDate,
                NepaliEndDate = dto.NepaliEndDate,
                TotalDays = totalDays,
                IsHalfDay = dto.IsHalfDay,
                HalfDayPeriod = dto.IsHalfDay ? dto.HalfDayPeriod : null,
                Reason = dto.Reason ?? string.Empty,
                Status = status,
                CreatedDate = DateTime.Now,
                SubmittedDate = dto.Submit ? DateTime.Now : null
            };

            _context.LeaveRequests.Add(entity);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetById), new { id = entity.LeaveRequestId }, new
            {
                entity.LeaveRequestId,
                message = dto.Submit ? "Leave request submitted successfully." : "Leave request saved as draft."
            });
        }

        // ── PUT api/LeaveRequests/{id} ─────────────────────────────────────────
        [HttpPut("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Update(int id, [FromBody] LeaveRequestInputDto dto)
        {
            var myEmpId = await CurrentEmployeeIdAsync();
            var isMgr = await CheckIsManagerAsync();
            var entity = await _context.LeaveRequests.FirstOrDefaultAsync(r => r.LeaveRequestId == id);

            if (entity is null) return NotFound(new { message = "Leave request not found." });

            if (!isMgr && entity.EmployeeId != myEmpId)
                return Forbid();

            if (entity.Status != LeaveRequestStatus.Draft && entity.Status != LeaveRequestStatus.Pending && !isMgr)
                return BadRequest(new { message = "Only Draft or Pending requests can be edited." });

            if (dto.StartDate.Date > dto.EndDate.Date)
                return BadRequest(new { message = "Start date cannot be after end date." });

            decimal totalDays = dto.IsHalfDay ? 0.5m : Math.Max(1.0m, (decimal)(dto.EndDate.Date - dto.StartDate.Date).TotalDays + 1);

            entity.LeaveType = string.IsNullOrWhiteSpace(dto.LeaveType) ? "Other" : dto.LeaveType;
            entity.StartDate = dto.StartDate.Date;
            entity.EndDate = dto.EndDate.Date;
            entity.NepaliStartDate = dto.NepaliStartDate;
            entity.NepaliEndDate = dto.NepaliEndDate;
            entity.TotalDays = totalDays;
            entity.IsHalfDay = dto.IsHalfDay;
            entity.HalfDayPeriod = dto.IsHalfDay ? dto.HalfDayPeriod : null;
            entity.Reason = dto.Reason ?? string.Empty;

            if (dto.Submit && entity.Status == LeaveRequestStatus.Draft)
            {
                entity.Status = LeaveRequestStatus.Pending;
                entity.SubmittedDate = DateTime.Now;
            }

            await _context.SaveChangesAsync();
            return Ok(new { message = "Leave request updated successfully." });
        }

        // ── POST api/LeaveRequests/{id}/submit ────────────────────────────────
        [HttpPost("{id:int}/submit")]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> Submit(int id)
        {
            var myEmpId = await CurrentEmployeeIdAsync();
            var isMgr = await CheckIsManagerAsync();
            var entity = await _context.LeaveRequests.FirstOrDefaultAsync(r => r.LeaveRequestId == id);

            if (entity is null) return NotFound(new { message = "Leave request not found." });

            if (!isMgr && entity.EmployeeId != myEmpId)
                return Forbid();

            if (entity.Status != LeaveRequestStatus.Draft)
                return BadRequest(new { message = "Only Draft requests can be submitted." });

            entity.Status = LeaveRequestStatus.Pending;
            entity.SubmittedDate = DateTime.Now;

            await _context.SaveChangesAsync();
            return Ok(new { message = "Leave request submitted for manager approval." });
        }

        // ── DELETE api/LeaveRequests/{id} ──────────────────────────────────────
        [HttpDelete("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> Delete(int id)
        {
            var myEmpId = await CurrentEmployeeIdAsync();
            var isMgr = await CheckIsManagerAsync();
            var entity = await _context.LeaveRequests.FirstOrDefaultAsync(r => r.LeaveRequestId == id);

            if (entity is null) return NotFound(new { message = "Leave request not found." });

            if (!isMgr && entity.EmployeeId != myEmpId)
                return Forbid();

            if (entity.Status != LeaveRequestStatus.Draft && entity.Status != LeaveRequestStatus.Pending && !isMgr)
                return BadRequest(new { message = "Only Draft or Pending requests can be cancelled/deleted." });

            _context.LeaveRequests.Remove(entity);
            await _context.SaveChangesAsync();
            return Ok(new { message = "Leave request deleted." });
        }

        // ── POST api/LeaveRequests/{id}/approve ───────────────────────────────
        [HttpPost("{id:int}/approve")]
        [Authorize]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        public async Task<IActionResult> Approve(int id, [FromBody] DecisionDto? dto)
        {
            if (!await CheckIsManagerAsync())
                return Forbid();

            var entity = await _context.LeaveRequests.FirstOrDefaultAsync(r => r.LeaveRequestId == id);
            if (entity is null) return NotFound(new { message = "Leave request not found." });

            if (entity.Status != LeaveRequestStatus.Pending)
                return BadRequest(new { message = "Only Pending requests can be approved." });

            entity.Status = LeaveRequestStatus.Approved;
            entity.DecidedDate = DateTime.Now;
            entity.DecidedBy = CurrentUserName;
            entity.AdminRemarks = dto?.Remarks;

            await _context.SaveChangesAsync();
            return Ok(new { message = "Leave request approved." });
        }

        // ── POST api/LeaveRequests/{id}/reject ────────────────────────────────
        [HttpPost("{id:int}/reject")]
        [Authorize]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        public async Task<IActionResult> Reject(int id, [FromBody] DecisionDto? dto)
        {
            if (!await CheckIsManagerAsync())
                return Forbid();

            var entity = await _context.LeaveRequests.FirstOrDefaultAsync(r => r.LeaveRequestId == id);
            if (entity is null) return NotFound(new { message = "Leave request not found." });

            if (entity.Status != LeaveRequestStatus.Pending)
                return BadRequest(new { message = "Only Pending requests can be rejected." });

            entity.Status = LeaveRequestStatus.Rejected;
            entity.DecidedDate = DateTime.Now;
            entity.DecidedBy = CurrentUserName;
            entity.AdminRemarks = dto?.Remarks;

            await _context.SaveChangesAsync();
            return Ok(new { message = "Leave request rejected." });
        }

        // ── GET api/LeaveRequests/summary ──────────────────────────────────────
        [HttpGet("summary")]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Summary([FromQuery] int? employeeId)
        {
            var myEmpId = await CurrentEmployeeIdAsync();
            var isMgr = await CheckIsManagerAsync();

            var query = _context.LeaveRequests.AsNoTracking().AsQueryable();

            if (!isMgr)
            {
                if (myEmpId is null)
                    return Ok(new { total = 0, pending = 0, approved = 0, rejected = 0, draft = 0, byType = new Dictionary<string, decimal>() });

                query = query.Where(r => r.EmployeeId == myEmpId.Value);
            }
            else if (employeeId.HasValue)
            {
                query = query.Where(r => r.EmployeeId == employeeId.Value);
            }

            var requests = await query.ToListAsync();

            var total = requests.Count;
            var pending = requests.Count(r => r.Status == LeaveRequestStatus.Pending);
            var approved = requests.Count(r => r.Status == LeaveRequestStatus.Approved);
            var rejected = requests.Count(r => r.Status == LeaveRequestStatus.Rejected);
            var draft = requests.Count(r => r.Status == LeaveRequestStatus.Draft);

            var byType = requests
                .Where(r => r.Status == LeaveRequestStatus.Approved)
                .GroupBy(r => r.LeaveType)
                .ToDictionary(g => g.Key, g => g.Sum(r => r.TotalDays));

            return Ok(new
            {
                total,
                pending,
                approved,
                rejected,
                draft,
                byType
            });
        }
    }

    public class LeaveRequestInputDto
    {
        public int? EmployeeId { get; set; }
        public string LeaveType { get; set; } = "Other";
        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }
        public string? NepaliStartDate { get; set; }
        public string? NepaliEndDate { get; set; }
        public bool IsHalfDay { get; set; } = false;
        public string? HalfDayPeriod { get; set; }
        public string? Reason { get; set; }
        public bool Submit { get; set; } = false;
    }

    public class DecisionDto
    {
        public string? Remarks { get; set; }
    }
}
