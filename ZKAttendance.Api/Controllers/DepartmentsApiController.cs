using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ZKAttendance.Api.Security;
using ZKAttendance.Api.Services;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Application.Dtos.Api;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Security;

namespace ZKAttendance.Api.Controllers
{
    /// <summary>Departments — full CRUD.</summary>
    [Route("api/Departments")]
    [ApiController]
    [Produces("application/json")]
    [Tags("Departments")]
    [Authorize(Roles = Roles.Management)]
    public class DepartmentsApiController : ControllerBase
    {
        private readonly IDepartmentService _service;
        private readonly ILogger<DepartmentsApiController> _logger;

        public DepartmentsApiController(IDepartmentService service, ILogger<DepartmentsApiController> logger)
        {
            _service = service;
            _logger = logger;
        }

        /// <summary>All departments.</summary>
        [HttpGet]
        [ProducesResponseType(200)]
        public async Task<IActionResult> GetAll()
        {
            var items = await _service.GetAllDepartmentsAsync();
            return Ok(items.Select(Shape));
        }

        /// <summary>One department by id.</summary>
        [HttpGet("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Get(int id)
        {
            var item = await _service.GetDepartmentByIdAsync(id);
            return item is null
                ? NotFound(ApiError.From($"Department {id} not found"))
                : Ok(Shape(item));
        }

        /// <summary>Create a department.</summary>
        [HttpPost]
        [ProducesResponseType(201)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> Create([FromBody] DepartmentRequest request)
        {
            try
            {
                var created = await _service.CreateDepartmentAsync(new Department
                {
                    DepartmentName = request.DepartmentName,
                    DepartmentCode = request.DepartmentCode,
                    ParentDepartmentId = request.ParentDepartmentId,
                    Description = request.Description,
                    IsActive = request.IsActive,
                    CreatedDate = DateTime.Now
                });

                return CreatedAtAction(nameof(Get), new { id = created.DepartmentId }, Shape(created));
            }
            catch (InvalidOperationException ex)
            {
                // The service throws this for a duplicate name.
                return BadRequest(ApiError.From(ex.Message));
            }
        }

        /// <summary>Update a department.</summary>
        [HttpPut("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Update(int id, [FromBody] DepartmentRequest request)
        {
            var existing = await _service.GetDepartmentByIdAsync(id);
            if (existing is null)
                return NotFound(ApiError.From($"Department {id} not found"));

            existing.DepartmentName = request.DepartmentName;
            existing.DepartmentCode = request.DepartmentCode;
            existing.ParentDepartmentId = request.ParentDepartmentId;
            existing.Description = request.Description;
            existing.IsActive = request.IsActive;
            existing.ModifiedDate = DateTime.Now;

            try
            {
                return Ok(Shape(await _service.UpdateDepartmentAsync(existing)));
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ApiError.From(ex.Message));
            }
        }

        /// <summary>Delete a department.</summary>
        /// <remarks>
        /// Refused if the department still has employees or sub-departments.
        /// Deleting it would orphan them, so the service checks first.
        /// </remarks>
        [HttpDelete("{id:int}")]
        [ProducesResponseType(204)]
        [ProducesResponseType(typeof(ApiError), 400)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetDepartmentByIdAsync(id);
            if (existing is null)
                return NotFound(ApiError.From($"Department {id} not found"));

            if (!await _service.CanDeleteDepartmentAsync(id))
                return BadRequest(ApiError.From(
                    "Cannot delete: the department still has employees or sub-departments."));

            await _service.DeleteDepartmentAsync(id);
            return NoContent();
        }

        private static object Shape(Department d) => new
        {
            d.DepartmentId,
            d.DepartmentName,
            d.DepartmentCode,
            d.ParentDepartmentId,
            d.Description,
            d.IsActive
        };
    }

    /// <summary>Employees — CRUD plus biometric device enrolment.</summary>
    [Route("api/Employees")]
    [ApiController]
    [Produces("application/json")]
    [Tags("Employees")]
    [Authorize(Roles = Roles.Management)]
    public class EmployeesApiController : ControllerBase
    {
        private readonly IEmployeeService _employees;
        private readonly IEmployeeDeviceEnrollment _enrollment;
        private readonly INepaliCalendar _nepali;
        private readonly ZKAttendance.Infrastructure.Persistence.AttendanceDbContext _db;
        private readonly Notifier _notifier;
        private readonly ILogger<EmployeesApiController> _logger;

        public EmployeesApiController(
            IEmployeeService employees,
            IEmployeeDeviceEnrollment enrollment,
            INepaliCalendar nepali,
            ZKAttendance.Infrastructure.Persistence.AttendanceDbContext db,
            Notifier notifier,
            ILogger<EmployeesApiController> logger)
        {
            _employees = employees;
            _enrollment = enrollment;
            _nepali = nepali;
            _db = db;
            _notifier = notifier;
            _logger = logger;
        }

        private int? CurrentUserId => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
        private bool IsAdmin => User.IsInRole("Admin");

        /// <summary>All approved employees, optionally filtered by department.</summary>
        /// <param name="departmentId">Only employees in this department.</param>
        /// <param name="includePending">Also return employees still awaiting approval.</param>
        [HttpGet]
        [ProducesResponseType(200)]
        public async Task<IActionResult> GetAll([FromQuery] int? departmentId = null, [FromQuery] bool includePending = false)
        {
            var items = departmentId.HasValue
                ? await _employees.GetEmployeesByDepartmentIdAsync(departmentId.Value)
                : await _employees.GetAllEmployeesAsync();

            // Hide records awaiting / denied approval. Legacy rows have an
            // empty ApprovalStatus and count as approved.
            if (!includePending)
                items = items.Where(e => e.ApprovalStatus != "Pending" && e.ApprovalStatus != "Rejected").ToList();

            var logins = await _db.ApiUsers
                .Where(u => u.EmployeeId != null)
                .Select(u => new { u.EmployeeId, u.ApiUserId, u.Username, u.Role, u.IsActive })
                .ToDictionaryAsync(u => u.EmployeeId!.Value);

            return Ok(items.Select(e =>
            {
                logins.TryGetValue(e.EmployeeId, out var login);
                return Shape(e, login is null ? null : new
                {
                    userId = login.ApiUserId,
                    username = login.Username,
                    role = login.Role,
                    active = login.IsActive
                });
            }));
        }

        /// <summary>Employees added by HR that still need an Admin decision.</summary>
        [HttpGet("pending")]
        [Authorize(Roles = Roles.Admin)]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Pending()
        {
            var rows = await _db.Employees
                .Where(e => e.ApprovalStatus == "Pending")
                .OrderBy(e => e.CreatedDate)
                .ToListAsync();

            var requesters = await _db.ApiUsers
                .Where(u => rows.Select(r => r.RequestedByUserId).Contains(u.ApiUserId))
                .ToDictionaryAsync(u => u.ApiUserId, u => u.Username);

            return Ok(rows.Select(e => new
            {
                e.EmployeeId,
                e.EmployeeName,
                e.BiometricUserId,
                e.DepartmentId,
                e.Title,
                e.CreatedDate,
                requestedBy = e.RequestedByUserId.HasValue && requesters.TryGetValue(e.RequestedByUserId.Value, out var u) ? u : null
            }));
        }

        /// <summary>One employee by id.</summary>
        [HttpGet("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Get(int id)
        {
            var item = await _employees.GetEmployeeByIdAsync(id);
            if (item is null) return NotFound(ApiError.From($"Employee {id} not found"));

            var login = await _db.ApiUsers
                .Where(u => u.EmployeeId == id)
                .Select(u => new { userId = u.ApiUserId, username = u.Username, role = u.Role, active = u.IsActive })
                .FirstOrDefaultAsync();

            return Ok(Shape(item, login));
        }

        /// <summary>Create an employee.</summary>
        /// <remarks>
        /// Leave BiometricUserId empty and the next free number is allocated.
        /// Supplying one that is already taken is rejected — two people sharing
        /// an enrol number would make their punches indistinguishable.
        /// </remarks>

        /// <summary>
        /// Trim, and treat blank as absent.
        ///
        /// "  ram@x.com " and "ram@x.com" are the same address to a person but
        /// two different values to a unique index, and an empty string is not
        /// the same as "no email" once the index is filtered on NOT NULL.
        /// </summary>
        private static string? NormaliseEmail(string? email)
            => string.IsNullOrWhiteSpace(email) ? null : email.Trim();

        /// <summary>
        /// True when another employee already holds this address.
        ///
        /// Checked here so the user gets a sentence rather than a unique-index
        /// violation surfacing as a 500. The index still exists as the real
        /// guarantee; this is the friendly path, not the enforcement.
        /// </summary>
        private async Task<bool> EmailTakenAsync(string? email, int? excludeEmployeeId, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(email)) return false;

            var normalised = email.Trim().ToLower();
            return await _db.Employees.AnyAsync(
                e => e.Email != null
                     && e.Email.ToLower() == normalised
                     && (excludeEmployeeId == null || e.EmployeeId != excludeEmployeeId.Value),
                ct);
        }

        [HttpPost]
        [DisableRequestSizeLimit]
        [ProducesResponseType(201)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> Create([FromBody] EmployeeRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.EmployeeName))
                return BadRequest(ApiError.From("Employee name is required."));

            if (!request.DepartmentId.HasValue || request.DepartmentId.Value <= 0)
                return BadRequest(ApiError.From("Department is required. Please select a department."));

            var deptExists = await _db.Departments.AnyAsync(d => d.DepartmentId == request.DepartmentId.Value);
            if (!deptExists)
                return BadRequest(ApiError.From("Selected department does not exist."));

            var biometricId = string.IsNullOrWhiteSpace(request.BiometricUserId)
                ? await _employees.GetNextBiometricUserIdAsync()
                : request.BiometricUserId.Trim();

            if (await _employees.IsBiometricIdExistsAsync(biometricId))
                return BadRequest(ApiError.From($"Biometric ID '{biometricId}' is already in use"));

            // Attendance emails are personal, so a shared address would send
            // one employee another's check-in times.
            if (await EmailTakenAsync(request.Email, null))
                return BadRequest(ApiError.From(
                    $"Email '{request.Email!.Trim()}' already belongs to another employee. " +
                    "Each person needs their own address so attendance emails reach the right one."));

            // Admin → approved immediately. HR → pending an Admin decision.
            var pending = !IsAdmin;

            var created = await _employees.CreateEmployeeAsync(new Employee
            {
                EmployeeName = request.EmployeeName,
                BiometricUserId = biometricId,
                DepartmentId = request.DepartmentId,
                DefaultShiftId = request.DefaultShiftId,
                PhoneNumber = request.PhoneNumber,
                Title = request.Title,
                Email = NormaliseEmail(request.Email),
                SSN = request.SSN,
                Gender = request.Gender,
                BirthDate = request.BirthDate,
                HireDate = request.HireDate,
                PhotoUrl = request.PhotoUrl,
                CheckAttendance = request.CheckAttendance,
                CheckLate = request.CheckLate,
                CheckEarly = request.CheckEarly,
                CheckOvertime = request.CheckOvertime,
                CheckHoliday = request.CheckHoliday,
                IsActive = pending ? false : request.IsActive,
                ApprovalStatus = pending ? "Pending" : "Approved",
                RequestedByUserId = CurrentUserId,
                ApprovedByUserId = pending ? null : CurrentUserId,
                ApprovedDate = pending ? null : DateTime.Now,
                CreatedDate = DateTime.Now
            });

            // Enrol on the device(s) this person is already on, so their punches
            // attribute immediately (the "Employee + EmployeeDevice" step).
            if (request.LinkDeviceIds is { Count: > 0 } deviceIds)
            {
                try
                {
                    await _enrollment.AssignAsync(created.EmployeeId, deviceIds.Distinct());
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogWarning(ex, "Could not link employee {Id} to devices", created.EmployeeId);
                }
            }

            if (pending)
            {
                // CreateEmployeeAsync force-sets IsActive = true; a pending
                // record must stay inactive until an admin approves it.
                created.IsActive = false;
                await _db.SaveChangesAsync();

                await _notifier.ToRoleAsync("Admin",
                    $"{User.Identity?.Name} requested to add employee \"{created.EmployeeName}\".",
                    "/employees/pending", "employee-approval-request");
                if (CurrentUserId is { } uid)
                    await _notifier.ToUserAsync(uid,
                        $"Your request to add \"{created.EmployeeName}\" was sent to an admin for approval.",
                        "/employees", "employee-approval-request");
            }

            return CreatedAtAction(nameof(Get), new { id = created.EmployeeId }, Shape(created));
        }

        /// <summary>Approve a pending employee. Admin only.</summary>
        [HttpPost("{id:int}/approve")]
        [Authorize(Roles = Roles.Admin)]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Approve(int id)
        {
            var e = await _db.Employees.FirstOrDefaultAsync(x => x.EmployeeId == id);
            if (e is null) return NotFound(ApiError.From($"Employee {id} not found"));
            if (e.ApprovalStatus != "Pending") return BadRequest(ApiError.From("This employee is not pending approval."));

            e.ApprovalStatus = "Approved";
            e.IsActive = true;
            e.ApprovedByUserId = CurrentUserId;
            e.ApprovedDate = DateTime.Now;
            await _db.SaveChangesAsync();

            if (e.RequestedByUserId is { } uid)
                await _notifier.ToUserAsync(uid,
                    $"\"{e.EmployeeName}\" was approved and added by {User.Identity?.Name}.",
                    "/employees", "employee-approved");

            return Ok(new { id, e.ApprovalStatus, message = "Employee approved" });
        }

        /// <summary>Reject a pending employee. Admin only.</summary>
        [HttpPost("{id:int}/reject")]
        [Authorize(Roles = Roles.Admin)]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Reject(int id, [FromBody] RejectRequest? body = null)
        {
            var e = await _db.Employees.FirstOrDefaultAsync(x => x.EmployeeId == id);
            if (e is null) return NotFound(ApiError.From($"Employee {id} not found"));
            if (e.ApprovalStatus != "Pending") return BadRequest(ApiError.From("This employee is not pending approval."));

            e.ApprovalStatus = "Rejected";
            e.IsActive = false;
            e.ApprovedByUserId = CurrentUserId;
            e.ApprovedDate = DateTime.Now;
            await _db.SaveChangesAsync();

            if (e.RequestedByUserId is { } uid)
                await _notifier.ToUserAsync(uid,
                    $"Your request to add \"{e.EmployeeName}\" was rejected by {User.Identity?.Name}." +
                    (string.IsNullOrWhiteSpace(body?.Reason) ? "" : $" Reason: {body!.Reason}"),
                    "/employees", "employee-rejected");

            return Ok(new { id, e.ApprovalStatus, message = "Employee rejected" });
        }

        /// <summary>
        /// Give an existing employee a login account, linked 1:1 to them. This
        /// is the ONLY way a login is created — every ApiUser belongs to an
        /// employee.
        /// </summary>
        [HttpPost("{id:int}/create-login")]
        [Authorize(Roles = Roles.Admin)]
        [ProducesResponseType(201)]
        [ProducesResponseType(typeof(ApiError), 400)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> CreateLogin(int id, [FromBody] CreateLoginRequest request)
        {
            var emp = await _employees.GetEmployeeByIdAsync(id);
            if (emp is null) return NotFound(ApiError.From($"Employee {id} not found"));
            if (emp.ApprovalStatus != "Approved" && emp.ApprovalStatus != "")
                return BadRequest(ApiError.From("Approve this employee before giving them a login."));

            var role = new[] { "Admin", "HR", "Employee" }
                .FirstOrDefault(r => r.Equals(request.Role, StringComparison.OrdinalIgnoreCase)) ?? "Employee";

            if (await _db.ApiUsers.AnyAsync(u => u.EmployeeId == id))
                return BadRequest(ApiError.From("This employee already has a login."));

            // The login shares the employee's identity. Fall back to a stable,
            // unique address derived from the biometric id if they have no email.
            var email = !string.IsNullOrWhiteSpace(emp.Email)
                ? emp.Email!.Trim()
                : $"emp{emp.BiometricUserId}@zkattendance.local";

            // A legacy orphan account with this employee's email (from the old
            // separate register flow) — adopt it instead of creating a second.
            var orphan = await _db.ApiUsers
                .FirstOrDefaultAsync(u => u.EmployeeId == null && u.Email.ToLower() == email.ToLower());
            if (orphan is not null)
            {
                orphan.EmployeeId = id;
                await _db.SaveChangesAsync();
                _logger.LogInformation("Adopted orphan login '{Username}' for employee {Id} by {By}", orphan.Username, id, User.Identity?.Name);
                return Ok(new { orphan.ApiUserId, orphan.Username, orphan.Role, employeeId = id, adopted = true });
            }

            var username = request.Username.Trim();
            if (username.Length < 3) return BadRequest(ApiError.From("Username must be at least 3 characters."));
            if (request.Password.Length < 8) return BadRequest(ApiError.From("Password must be at least 8 characters."));

            if (await _db.ApiUsers.AnyAsync(u => u.Username.ToLower() == username.ToLower()))
                return BadRequest(ApiError.From($"Username '{username}' is already taken."));
            if (await _db.ApiUsers.AnyAsync(u => u.Email.ToLower() == email.ToLower()))
                return BadRequest(ApiError.From($"Email '{email}' is already used by another account. Change this employee's email first."));

            var (hash, salt) = PasswordHasher.HashPassword(request.Password);
            var user = new ApiUser
            {
                Username = username,
                Email = email,
                PasswordHash = hash,
                PasswordSalt = salt,
                Role = role,
                EmployeeId = id,
                IsActive = true,
                CreatedDate = DateTime.Now
            };
            _db.ApiUsers.Add(user);
            await _db.SaveChangesAsync();

            _logger.LogInformation("Login '{Username}' ({Role}) created for employee {Id} by {By}", username, role, id, User.Identity?.Name);
            return StatusCode(201, new { user.ApiUserId, user.Username, user.Role, employeeId = id });
        }

        /// <summary>Update an employee.</summary>
        [HttpPut("{id:int}")]
        [DisableRequestSizeLimit]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 400)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Update(int id, [FromBody] EmployeeRequest request)
        {
            var existing = await _employees.GetEmployeeByIdAsync(id);
            if (existing is null)
                return NotFound(ApiError.From($"Employee {id} not found"));

            if (!string.IsNullOrWhiteSpace(request.BiometricUserId) &&
                request.BiometricUserId != existing.BiometricUserId)
            {
                if (await _employees.IsBiometricIdExistsAsync(request.BiometricUserId, id))
                    return BadRequest(ApiError.From(
                        $"Biometric ID '{request.BiometricUserId}' is already in use"));

                existing.BiometricUserId = request.BiometricUserId.Trim();
            }

            if (await EmailTakenAsync(request.Email, id))
                return BadRequest(ApiError.From(
                    $"Email '{request.Email!.Trim()}' already belongs to another employee. " +
                    "Each person needs their own address so attendance emails reach the right one."));

            if (string.IsNullOrWhiteSpace(request.EmployeeName))
                return BadRequest(ApiError.From("Employee name is required."));

            if (!request.DepartmentId.HasValue || request.DepartmentId.Value <= 0)
                return BadRequest(ApiError.From("Department is required. Please select a department."));

            var deptExists = await _db.Departments.AnyAsync(d => d.DepartmentId == request.DepartmentId.Value);
            if (!deptExists)
                return BadRequest(ApiError.From("Selected department does not exist."));

            existing.EmployeeName = request.EmployeeName;
            existing.DepartmentId = request.DepartmentId;
            existing.DefaultShiftId = request.DefaultShiftId;
            existing.PhoneNumber = request.PhoneNumber;
            existing.Title = request.Title;
            existing.Email = NormaliseEmail(request.Email);
            existing.SSN = request.SSN;
            existing.Gender = request.Gender;
            existing.BirthDate = request.BirthDate;
            existing.HireDate = request.HireDate;
            existing.PhotoUrl = request.PhotoUrl;
            existing.CheckAttendance = request.CheckAttendance;
            existing.CheckLate = request.CheckLate;
            existing.CheckEarly = request.CheckEarly;
            existing.CheckOvertime = request.CheckOvertime;
            existing.CheckHoliday = request.CheckHoliday;
            existing.IsActive = request.IsActive;
            existing.ModifiedDate = DateTime.Now;

            return Ok(Shape(await _employees.UpdateEmployeeAsync(existing)));
        }

        /// <summary>Deactivate an employee.</summary>
        /// <remarks>
        /// Sets IsActive to false rather than deleting. Their attendance history
        /// is a payroll record and must survive them leaving.
        /// </remarks>
        [HttpPost("{id:int}/deactivate")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Deactivate(int id)
        {
            var existing = await _employees.GetEmployeeByIdAsync(id);
            if (existing is null)
                return NotFound(ApiError.From($"Employee {id} not found"));

            existing.IsActive = false;
            existing.ModifiedDate = DateTime.Now;
            await _employees.UpdateEmployeeAsync(existing);

            _logger.LogInformation("Employee {Id} deactivated through the API", id);
            return Ok(new { id, isActive = false, message = "Employee deactivated" });
        }

        /// <summary>Upload or clear an employee's profile photo (base-64 data-URL).</summary>
        [HttpPatch("{id:int}/photo")]
        [DisableRequestSizeLimit]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> UpdatePhoto(int id, [FromBody] PhotoRequest request)
        {
            var existing = await _employees.GetEmployeeByIdAsync(id);
            if (existing is null)
                return NotFound(ApiError.From($"Employee {id} not found"));
            existing.PhotoUrl = request.PhotoUrl;
            existing.ModifiedDate = DateTime.Now;
            await _employees.UpdateEmployeeAsync(existing);
            return Ok(new { id, photoUrl = existing.PhotoUrl });
        }

        /// <summary>
        /// Permanently delete an employee. Allowed only when they have NO
        /// attendance history and NO device mappings — otherwise you would
        /// orphan payroll rows, so the API refuses and you should
        /// <c>deactivate</c> instead.
        /// </summary>
        [HttpDelete("{id:int}")]
        [Authorize(Roles = Roles.Admin)]
        [ProducesResponseType(204)]
        [ProducesResponseType(typeof(ApiError), 400)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _employees.GetEmployeeByIdAsync(id);
            if (existing is null)
                return NotFound(ApiError.From($"Employee {id} not found"));

            var punchCount = await _db.AttendanceLogs.CountAsync(a => a.EmployeeId == id);
            if (punchCount > 0)
                return BadRequest(ApiError.From(
                    $"Employee {id} has {punchCount} attendance record(s). Deactivate them instead of deleting, " +
                    "or purge their punches first from the Punches screen."));

            var maps = await _db.EmployeeDevices.Where(ed => ed.EmployeeId == id).ToListAsync();
            _db.EmployeeDevices.RemoveRange(maps);

            var accounts = await _db.ApiUsers.Where(u => u.EmployeeId == id).ToListAsync();
            foreach (var a in accounts) a.EmployeeId = null; // unlink, keep the login

            _db.Employees.Remove(await _db.Employees.FirstAsync(e => e.EmployeeId == id));
            await _db.SaveChangesAsync();

            _logger.LogWarning("Employee {Id} permanently deleted by {User}", id, User.Identity?.Name);
            return NoContent();
        }

        /// <summary>Link an employee to biometric devices.</summary>
        /// <remarks>
        /// Records which machines this person should exist on, and the enrol
        /// number each one knows them by. The numbers can differ per device:
        /// each machine allocates its own, so 1017 at head office may be 88 at
        /// the branch because 1017 was already taken there.
        ///
        /// This records intent. Writing the fingerprint template to the device
        /// is a separate step that needs the ZKTeco SDK.
        /// </remarks>
        [HttpPost("{id:int}/enroll-on-devices")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> EnrollOnDevices(
            int id,
            [FromBody] EnrollOnDevicesRequest request,
            [FromServices] IEmployeeDeviceEnrollment enrollment)
        {
            var employee = await _employees.GetEmployeeByIdAsync(id);
            if (employee is null)
                return NotFound(ApiError.From($"Employee {id} not found"));

            var result = await enrollment.AssignAsync(
                id, request.DeviceIds, request.DeviceUserIds);

            return Ok(new
            {
                employeeId = id,
                employee.EmployeeName,
                assigned = result.Select(r => new { r.DeviceId, r.DeviceUserId, r.IsEnrolled })
            });
        }

        /// <summary>
        /// Biometric IDs seen in punches that belong to no employee — the front
        /// of the funnel. An ID counts as "registered" if it is an
        /// Employee.BiometricUserId OR an EmployeeDevices entry. Each result
        /// carries the device(s) it was seen on so completing the employee also
        /// creates the EmployeeDevice link.
        /// </summary>
        [HttpGet("unregistered")]
        [ProducesResponseType(200)]
        public async Task<IActionResult> GetUnregistered()
        {
            var known = new HashSet<string>(
                await _db.Employees.Select(e => e.BiometricUserId).ToListAsync());
            foreach (var id in await _db.EmployeeDevices.Select(ed => ed.BiometricUserId).ToListAsync())
                known.Add(id);

            var rows = await _db.AttendanceLogs
                .Where(a => a.EmployeeId == null)
                .GroupBy(a => a.BiometricUserId)
                .Select(g => new
                {
                    biometricUserId = g.Key,
                    deviceIds = g.Select(x => x.DeviceId).Distinct().ToList(),
                    punchCount = g.Count(),
                    lastSeen = g.Max(x => x.AttendanceTime)
                })
                .ToListAsync();

            var result = rows
                .Where(r => !known.Contains(r.biometricUserId))
                .OrderBy(r => int.TryParse(r.biometricUserId, out var n) ? n : int.MaxValue)
                .ToList();

            return Ok(result);
        }

        /// <summary>
        /// Reconciles attendance log mappings against active employee biometric IDs and device assignments.
        /// Repairs punches that were misattributed or unlinked due to ID changes.
        /// </summary>
        [HttpPost("reconcile-attendance")]
        [Authorize(Roles = Roles.Management)]
        [ProducesResponseType(200)]
        public async Task<IActionResult> ReconcileAttendance()
        {
            var repaired = await _employees.ReconcileAttendanceLogMappingsAsync();
            return Ok(new
            {
                repaired,
                message = repaired == 0
                    ? "All attendance logs are properly attributed."
                    : $"Successfully repaired {repaired} attendance log mapping(s)."
            });
        }

        private object Shape(Employee e, object? login = null) => new
        {
            e.EmployeeId,
            e.EmployeeName,
            e.BiometricUserId,
            e.DepartmentId,
            e.DefaultShiftId,
            e.PhoneNumber,
            e.Title,
            e.Email,
            e.SSN,
            e.Gender,
            e.BirthDate,
            e.CheckAttendance,
            e.CheckLate,
            e.CheckEarly,
            e.CheckOvertime,
            e.CheckHoliday,
            hireDate = e.HireDate,
            hireDateBs = e.HireDate.HasValue ? _nepali.ToBsString(e.HireDate.Value) : null,
            e.PhotoUrl,
            e.IsActive,
            e.ApprovalStatus,
            hasLogin = login is not null,
            login
        };
    }

    public class PhotoRequest
    {
        public string? PhotoUrl { get; set; }
    }

    public class RejectRequest
    {
        public string? Reason { get; set; }
    }

    public class CreateLoginRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;

        /// <summary>"Employee" (default), "HR" or "Admin".</summary>
        public string Role { get; set; } = "Employee";
    }
}
