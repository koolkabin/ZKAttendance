using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ZKAttendance.Application.Dtos.Api;
using ZKAttendance.Infrastructure.Persistence;
using ZKAttendance.Infrastructure.Security;

namespace ZKAttendance.Api.Controllers
{
    /// <summary>The signed-in account: profile and password.</summary>
    [Route("api/Account")]
    [ApiController]
    [Produces("application/json")]
    [Tags("Account")]
    [Authorize]
    public class AccountApiController : ControllerBase
    {
        private readonly AttendanceDbContext _context;
        private readonly ILogger<AccountApiController> _logger;

        public AccountApiController(AttendanceDbContext context, ILogger<AccountApiController> logger)
        {
            _context = context;
            _logger = logger;
        }

        private int? CurrentUserId =>
            int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

        /// <summary>The current account, plus the linked employee record if there is one.</summary>
        [HttpGet("profile")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Profile()
        {
            var id = CurrentUserId;
            if (id is null) return Unauthorized(ApiError.From("Token has no user id"));

            var user = await _context.ApiUsers.AsNoTracking()
                .FirstOrDefaultAsync(u => u.ApiUserId == id.Value);
            if (user is null) return NotFound(ApiError.From("Account not found"));

            string? employeeName = null, departmentName = null, photoUrl = null, title = null, employeeCode = null;
            if (user.EmployeeId.HasValue)
            {
                var emp = await _context.Employees.AsNoTracking()
                    .Include(e => e.Department)
                    .FirstOrDefaultAsync(e => e.EmployeeId == user.EmployeeId.Value);
                employeeName = emp?.EmployeeName;
                departmentName = emp?.Department?.DepartmentName;
                photoUrl = emp?.PhotoUrl;
                title = emp?.Title;
                employeeCode = emp?.BiometricUserId;
            }

            return Ok(new
            {
                user.ApiUserId,
                user.Username,
                user.Email,
                user.Role,
                user.IsActive,
                user.CreatedDate,
                user.LastLoginDate,
                user.EmployeeId,
                employeeName,
                departmentName,
                photoUrl,
                title,
                employeeCode
            });
        }

        /// <summary>Change the current account's password.</summary>
        [HttpPost("change-password")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            var id = CurrentUserId;
            if (id is null) return Unauthorized(ApiError.From("Token has no user id"));

            var user = await _context.ApiUsers.FirstOrDefaultAsync(u => u.ApiUserId == id.Value);
            if (user is null) return NotFound(ApiError.From("Account not found"));

            if (!PasswordHasher.VerifyPassword(request.CurrentPassword, user.PasswordHash, user.PasswordSalt))
                return BadRequest(ApiError.From("Current password does not match our records."));

            var (hash, salt) = PasswordHasher.HashPassword(request.NewPassword);
            user.PasswordHash = hash;
            user.PasswordSalt = salt;
            await _context.SaveChangesAsync();

            _logger.LogInformation("Password changed for user {UserId}", user.ApiUserId);
            return Ok(new { message = "Password updated" });
        }
    }
}
