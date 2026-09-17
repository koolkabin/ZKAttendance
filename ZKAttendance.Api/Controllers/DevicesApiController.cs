using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ZKAttendance.Api.Security;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Application.Dtos.Api;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Services.Devices;

namespace ZKAttendance.Api.Controllers
{
    /// <summary>
    /// Biometric devices. HR can see the list and status; the network details
    /// (IP, port, serial, comm password) and every write operation are Admin only.
    /// </summary>
    [Route("api/Devices")]
    [ApiController]
    [Produces("application/json")]
    [Tags("Devices")]
    [Authorize(Roles = Roles.Management)]
    public class DevicesApiController : ControllerBase
    {
        private readonly IDeviceService _devices;
        private readonly IAttendanceSyncService _sync;
        private readonly ILogger<DevicesApiController> _logger;

        public DevicesApiController(
            IDeviceService devices,
            IAttendanceSyncService sync,
            ILogger<DevicesApiController> logger)
        {
            _devices = devices;
            _sync = sync;
            _logger = logger;
        }

        private bool IsAdmin => User.IsInRole("Admin");

        /// <summary>All registered devices.</summary>
        /// <param name="onlineOnly">Return only devices currently reachable.</param>
        [HttpGet]
        [ProducesResponseType(200)]
        public async Task<IActionResult> GetAll([FromQuery] bool onlineOnly = false)
        {
            var items = onlineOnly
                ? await _devices.GetOnlineDevicesAsync()
                : await _devices.GetAllDevicesAsync(includeInactive: true);

            return Ok(items.Select(Shape));
        }

        /// <summary>One device by id.</summary>
        [HttpGet("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Get(int id)
        {
            var item = await _devices.GetDeviceByIdAsync(id);
            return item is null
                ? NotFound(ApiError.From($"Device {id} not found"))
                : Ok(Shape(item));
        }

        /// <summary>Register a device.</summary>
        /// <remarks>
        /// The device does not have to be reachable to be registered. The
        /// monitor will report it offline until it is.
        ///
        /// Setting Role to "Master" fails if another active master exists — the
        /// database enforces one master with a filtered unique index, because
        /// two enrolment sources produce colliding enrol numbers.
        /// </remarks>
        [Authorize(Roles = Roles.Admin)]
        [HttpPost]
        [ProducesResponseType(201)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> Create([FromBody] DeviceRequest request)
        {
            if (!Enum.TryParse<DeviceRole>(request.Role, true, out var role))
                return BadRequest(ApiError.From(
                    $"Role must be 'Master' or 'Slave'; got '{request.Role}'"));

            if (!Enum.TryParse<ZKAttendance.Domain.Enums.DeviceType>(request.DeviceType, true, out var deviceType))
                return BadRequest(ApiError.From(
                    $"DeviceType '{request.DeviceType}' is not recognised. " +
                    "Valid values: ZkTeco, Hikvision, Dahua, Anviz, eSSL, HttpPush, Fake."));

            try
            {
                var created = await _devices.CreateDeviceAsync(new Device
                {
                    DeviceName = request.DeviceName,
                    DeviceIP = request.DeviceIP,
                    DevicePort = request.DevicePort,
                    SerialNumber = request.SerialNumber,
                    DeviceModel = request.DeviceModel,
                    CommPassword = request.CommPassword,
                    BranchId = request.BranchId,
                    Role = role,
                    DeviceType = deviceType,
                    IsActive = request.IsActive,
                    CreatedDate = DateTime.Now
                });

                return CreatedAtAction(nameof(Get), new { id = created.DeviceId }, Shape(created));
            }
            catch (InvalidOperationException ex)
            {
                // Duplicate IP + port, or a second master.
                return BadRequest(ApiError.From(ex.Message));
            }
        }

        /// <summary>Update a device.</summary>
        [Authorize(Roles = Roles.Admin)]
        [HttpPut("{id:int}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 400)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Update(int id, [FromBody] DeviceRequest request)
        {
            var existing = await _devices.GetDeviceByIdAsync(id);
            if (existing is null)
                return NotFound(ApiError.From($"Device {id} not found"));

            if (!Enum.TryParse<DeviceRole>(request.Role, true, out var role))
                return BadRequest(ApiError.From($"Role must be 'Master' or 'Slave'; got '{request.Role}'"));

            if (!Enum.TryParse<ZKAttendance.Domain.Enums.DeviceType>(request.DeviceType, true, out var deviceType))
                return BadRequest(ApiError.From(
                    $"DeviceType '{request.DeviceType}' is not recognised. " +
                    "Valid values: ZkTeco, Hikvision, Dahua, Anviz, eSSL, HttpPush, Fake."));

            existing.DeviceName = request.DeviceName;
            existing.DeviceIP = request.DeviceIP;
            existing.DevicePort = request.DevicePort;
            existing.SerialNumber = request.SerialNumber;
            existing.DeviceModel = request.DeviceModel;
            existing.CommPassword = request.CommPassword;
            existing.BranchId = request.BranchId;
            existing.Role = role;
            existing.DeviceType = deviceType;
            existing.IsActive = request.IsActive;
            existing.ModifiedDate = DateTime.Now;

            try
            {
                return Ok(Shape(await _devices.UpdateDeviceAsync(existing)));
            }
            catch (InvalidOperationException ex)
            {
                // Duplicate IP + port, or a second master.
                return BadRequest(ApiError.From(ex.Message));
            }
        }

        /// <summary>Pull attendance from this device right now.</summary>
        /// <remarks>
        /// Normally this happens on a five-minute timer. This runs it on demand
        /// and returns the counts, so you can watch the pipeline without
        /// waiting or reading the console.
        ///
        /// Duplicates is not a failure — re-reading records already stored is
        /// expected, because most ZKTeco models return their whole log every time.
        /// </remarks>
        [Authorize(Roles = Roles.Admin)]
        [HttpPost("{id:int}/sync")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Sync(int id, CancellationToken ct)
        {
            var device = await _devices.GetDeviceByIdAsync(id);
            if (device is null)
                return NotFound(ApiError.From($"Device {id} not found"));

            _logger.LogInformation("Manual sync requested for device {Id}", id);
            return Ok(await _sync.SyncDeviceAsync(id, ct));
        }

        /// <summary>Test whether the device answers on the network.</summary>
        [Authorize(Roles = Roles.Admin)]
        [HttpPost("{id:int}/test-connection")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> TestConnection(int id)
        {
            var device = await _devices.GetDeviceByIdAsync(id);
            if (device is null)
                return NotFound(ApiError.From($"Device {id} not found"));

            var (success, message) = await _devices.TestDeviceConnectionAsync(id);
            return Ok(new { deviceId = id, device.DeviceName, device.DeviceIP, success, message });
        }

        /// <summary>Deactivate a device.</summary>
        /// <remarks>
        /// Sets IsActive to false rather than deleting. Its historic attendance
        /// rows reference it by foreign key, and deleting the row would either
        /// fail or orphan them.
        /// </remarks>
        [Authorize(Roles = Roles.Admin)]
        [HttpPost("{id:int}/deactivate")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Deactivate(int id)
        {
            var device = await _devices.GetDeviceByIdAsync(id);
            if (device is null)
                return NotFound(ApiError.From($"Device {id} not found"));

            device.IsActive = false;
            device.ModifiedDate = DateTime.Now;
            await _devices.UpdateDeviceAsync(device);

            _logger.LogInformation("Device {Id} deactivated; it will be skipped by sync rounds", id);
            return Ok(new { id, isActive = false, message = "Device deactivated" });
        }

        /// <summary>Reactivate a previously deactivated device.</summary>
        [Authorize(Roles = Roles.Admin)]
        [HttpPost("{id:int}/reactivate")]
        [ProducesResponseType(200)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> Reactivate(int id)
        {
            var device = await _devices.GetDeviceByIdAsync(id);
            if (device is null)
                return NotFound(ApiError.From($"Device {id} not found"));

            device.IsActive = true;
            device.ModifiedDate = DateTime.Now;
            await _devices.UpdateDeviceAsync(device);

            _logger.LogInformation("Device {Id} reactivated", id);
            return Ok(new { id, isActive = true, message = "Device reactivated" });
        }

        private object Shape(Device d) => new
        {
            d.DeviceId,
            d.DeviceName,
            // Network details are Admin-only. HR sees the device exists and
            // whether it is online, but not how to reach it.
            deviceIP = IsAdmin ? d.DeviceIP : null,
            devicePort = IsAdmin ? d.DevicePort : (int?)null,
            serialNumber = IsAdmin ? d.SerialNumber : null,
            deviceModel = IsAdmin ? d.DeviceModel : null,
            commPassword = IsAdmin ? d.CommPassword : (int?)null,
            d.BranchId,
            role = d.Role.ToString(),
            deviceType = d.DeviceType.ToString(),
            d.IsActive,
            d.IsOnline,
            d.IsProvisioned,
            d.ConnectionStatus,
            d.LastCheckTime,
            d.LastConnectionTime
        };
    }

    /// <summary>Attendance records and daily summaries.</summary>
    [Route("api/Attendance")]
    [ApiController]
    [Produces("application/json")]
    [Tags("Attendance")]
    public class AttendanceApiController : ControllerBase
    {
        private readonly IAttendanceService _attendance;
        private readonly IEmployeeService _employees;
        private readonly IDeviceService _devices;
        private readonly INepaliCalendar _nepali;
        private readonly IManualAttendanceEntry _manual;
        private readonly ILogger<AttendanceApiController> _logger;

        public AttendanceApiController(
            IAttendanceService attendance,
            IEmployeeService employees,
            IDeviceService devices,
            INepaliCalendar nepali,
            IManualAttendanceEntry manual,
            ILogger<AttendanceApiController> logger)
        {
            _attendance = attendance;
            _employees = employees;
            _devices = devices;
            _nepali = nepali;
            _manual = manual;
            _logger = logger;
        }

        /// <summary>Raw attendance punches in a date range.</summary>
        /// <param name="from">Gregorian start date. Defaults to 7 days ago.</param>
        /// <param name="to">Gregorian end date. Defaults to today.</param>
        /// <remarks>
        /// These are the punches exactly as the devices reported them. Nothing
        /// is calculated here — working hours and status are derived when a
        /// report or screen is built, so a rule change can be re-applied
        /// without going back to the hardware.
        /// </remarks>
        [HttpGet]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Get(
            [FromQuery] DateTime? from = null,
            [FromQuery] DateTime? to = null)
        {
            var start = from ?? DateTime.Today.AddDays(-7);
            var end = to ?? DateTime.Today;

            var logs = await _attendance.GetAttendanceLogsByDateRangeAsync(start, end);

            return Ok(new
            {
                fromAd = start.ToString("yyyy-MM-dd"),
                toAd = end.ToString("yyyy-MM-dd"),
                fromBs = _nepali.ToBsString(start),
                toBs = _nepali.ToBsString(end),
                count = logs.Count,
                records = logs.Select(l => new
                {
                    l.LogId,
                    l.EmployeeId,
                    l.BiometricUserId,
                    l.DeviceId,
                    l.BranchId,
                    punchTimeAd = l.AttendanceTime,
                    punchDateBs = _nepali.ToBsString(l.AttendanceTime),
                    l.AttendanceType,
                    l.VerifyMethod,
                    l.IsManual
                })
            });
        }

        /// <summary>Present, absent and late counts for one day.</summary>
        /// <param name="date">Gregorian date. Defaults to today.</param>
        /// <param name="branchId">Restrict the counts to one branch.</param>
        /// <param name="departmentId">Restrict the counts to one department.</param>
        [HttpGet("daily-summary")]
        [ProducesResponseType(200)]
        public async Task<IActionResult> DailySummary(
            [FromQuery] DateTime? date = null,
            [FromQuery] int? branchId = null,
            [FromQuery] int? departmentId = null)
        {
            var day = date ?? DateTime.Today;
            var summary = await _attendance.GetDailyAttendanceReportSummaryAsync(day, branchId, departmentId);

            return Ok(new
            {
                dateAd = day.ToString("yyyy-MM-dd"),
                dateBs = _nepali.ToBsString(day),
                isWeeklyOff = _nepali.IsWeeklyOff(day),
                summary
            });
        }

        /// <summary>Record a punch by hand.</summary>
        /// <remarks>
        /// For the case where somebody genuinely worked but the device has no
        /// record — a failed scan, or a machine that was down. The row is
        /// flagged IsManual so it can be told apart from device data during an
        /// audit, and the reason is stored in Notes.
        /// </remarks>
        [HttpPost("manual")]
        [ProducesResponseType(201)]
        [ProducesResponseType(typeof(ApiError), 400)]
        [ProducesResponseType(typeof(ApiError), 404)]
        public async Task<IActionResult> AddManual([FromBody] ManualAttendanceRequest request)
        {
            var employee = await _employees.GetEmployeeByIdAsync(request.EmployeeId);
            if (employee is null)
                return NotFound(ApiError.From($"Employee {request.EmployeeId} not found"));

            var device = await _devices.GetDeviceByIdAsync(request.DeviceId);
            if (device is null)
                return NotFound(ApiError.From($"Device {request.DeviceId} not found"));

            try
            {
                var log = await _manual.AddAsync(
                    request.EmployeeId, request.DeviceId, request.PunchTime,
                    request.AttendanceType, request.Notes);

                _logger.LogInformation(
                    "Manual punch recorded for employee {Id} at {Time}",
                    request.EmployeeId, request.PunchTime);

                return StatusCode(201, new
                {
                    log.LogId,
                    log.EmployeeId,
                    employee.EmployeeName,
                    punchTimeAd = log.AttendanceTime,
                    punchDateBs = _nepali.ToBsString(log.AttendanceTime),
                    log.AttendanceType,
                    log.IsManual,
                    log.Notes
                });
            }
            catch (InvalidOperationException ex)
            {
                // Duplicate punch: same person, same device, same second.
                return BadRequest(ApiError.From(ex.Message));
            }
        }
    }
}
