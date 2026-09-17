using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ZKAttendance.Domain.Entities;
using DeviceType = ZKAttendance.Domain.Enums.DeviceType;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Api.Controllers
{
    // ================================================================
    // AgentIngestController
    //
    // The four endpoints the App2 (ZKAttendance.Agent) calls on App1.
    // Route: api/Agent  — matches CentralClient.HttpClientName calls.
    //
    // Auth: AgentKey + Secret (SHA-256 hashed) on every call.
    // No JWT — the agent is a machine process, not a person.
    // ================================================================

    [Route("api/[controller]")]
    [ApiController]
    [Produces("application/json")]
    public class AgentController : ControllerBase
    {
        private readonly AttendanceDbContext _db;
        private readonly ILogger<AgentController> _logger;

        public AgentController(AttendanceDbContext db, ILogger<AgentController> logger)
        {
            _db = db;
            _logger = logger;
        }

        // ── shared auth helper ───────────────────────────────────────

        private async Task<LocalServer?> AuthAsync(string? agentKey, string? secret, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(agentKey) || string.IsNullOrWhiteSpace(secret))
                return null;

            var server = await _db.LocalServers
                .Include(s => s.Branch)
                .FirstOrDefaultAsync(s => s.AgentKey == agentKey && s.IsActive, ct);

            if (server is null) return null;

            return HashSecret(secret) == server.SecretHash ? server : null;
        }

        internal static string HashSecret(string secret)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }

        // ── POST api/Agent/login ─────────────────────────────────────

        /// <summary>Called by the agent on startup. Returns identity info for the agent UI.</summary>
        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] AgentLoginRequest body, CancellationToken ct)
        {
            var server = await AuthAsync(body.AgentKey, body.Secret, ct);
            if (server is null)
            {
                _logger.LogWarning("Agent login rejected. AgentKey={Key}", body.AgentKey);
                return Unauthorized(new { message = "Invalid agent key or secret." });
            }

            server.LastHeartbeatAt = DateTime.Now;
            server.AgentVersion = body.AgentVersion;
            await _db.SaveChangesAsync(ct);

            _logger.LogInformation("Agent {Key} ({Name}) connected", server.AgentKey, server.ServerName);

            return Ok(new
            {
                localServerId = server.LocalServerId,
                serverName    = server.ServerName,
                branchId      = server.BranchId,
                branchName    = server.Branch?.BranchName,
                serverTime    = DateTime.Now,
                message       = "Connected."
            });
        }

        // ── POST api/Agent/heartbeat ─────────────────────────────────

        /// <summary>Lightweight ping. Agent calls this every minute.</summary>
        [HttpPost("heartbeat")]
        public async Task<IActionResult> Heartbeat([FromBody] AgentHeartbeatRequest body, CancellationToken ct)
        {
            var server = await AuthAsync(body.AgentKey, body.Secret, ct);
            if (server is null) return Unauthorized();

            server.LastHeartbeatAt = DateTime.Now;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        // ── GET api/Agent/devices ────────────────────────────────────

        /// <summary>
        /// Returns the active devices assigned to this agent's branch.
        /// The agent uses this to populate its Sync UI.
        /// </summary>
        [HttpGet("devices")]
        public async Task<IActionResult> Devices(
            [FromQuery] string agentKey,
            [FromQuery] string secret,
            CancellationToken ct)
        {
            var server = await AuthAsync(agentKey, secret, ct);
            if (server is null) return Unauthorized(new { message = "Invalid agent key or secret." });

            var devices = await _db.Devices
                .Where(d => d.BranchId == server.BranchId && d.IsActive)
                .Select(d => new
                {
                    d.DeviceId,
                    d.DeviceName,
                    d.DeviceIP,
                    d.DevicePort,
                    d.CommPassword,
                    d.SerialNumber,
                    d.DeviceModel,
                    role               = d.Role.ToString(),
                    deviceType         = d.DeviceType.ToString(),
                    d.IsOnline,
                    d.LastConnectionTime
                })
                .ToListAsync(ct);

            return Ok(new
            {
                localServerId = server.LocalServerId,
                deviceCount   = devices.Count,
                devices
            });
        }

        // ── POST api/Agent/devices ───────────────────────────────────
        /// <summary>Allows an agent to add a new device for its branch.</summary>
        [HttpPost("devices")]
        public async Task<IActionResult> CreateDevice(
            [FromBody] AgentCreateDeviceRequest body,
            [FromHeader(Name = "X-Agent-Secret")] string? secret,
            CancellationToken ct)
        {
            var server = await AuthAsync(body.AgentKey, secret ?? body.Secret, ct);
            if (server is null) return Unauthorized(new { message = "Invalid agent key or secret." });

            if (string.IsNullOrWhiteSpace(body.DeviceName) || string.IsNullOrWhiteSpace(body.DeviceIP))
                return BadRequest(new { message = "Device Name and IP address are required." });

            if (!Enum.TryParse<DeviceRole>(body.Role ?? "Slave", true, out var role))
                role = DeviceRole.Slave;

            if (!Enum.TryParse<DeviceType>(body.DeviceType ?? "ZkTeco", true, out var deviceType))
                deviceType = DeviceType.ZkTeco;

            var device = new Device
            {
                DeviceName = body.DeviceName.Trim(),
                DeviceType = deviceType,
                DeviceIP = body.DeviceIP.Trim(),
                DevicePort = body.DevicePort > 0 ? body.DevicePort : 4370,
                CommPassword = body.CommPassword,
                SerialNumber = body.SerialNumber?.Trim(),
                DeviceModel = body.DeviceModel?.Trim(),
                Role = role,
                BranchId = server.BranchId,
                IsActive = body.IsActive ?? true,
                CreatedDate = DateTime.Now
            };

            _db.Devices.Add(device);
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                device.DeviceId,
                device.DeviceName,
                device.DeviceIP,
                device.DevicePort,
                device.CommPassword,
                device.SerialNumber,
                device.DeviceModel,
                role = device.Role.ToString(),
                deviceType = device.DeviceType.ToString(),
                device.IsActive,
                device.IsOnline,
                message = "Device added successfully."
            });
        }

        // ── PUT api/Agent/devices/{id} ───────────────────────────────
        /// <summary>Allows an agent to update a device assigned to its branch.</summary>
        [HttpPut("devices/{id:int}")]
        public async Task<IActionResult> UpdateDevice(
            int id,
            [FromBody] AgentUpdateDeviceRequest body,
            [FromHeader(Name = "X-Agent-Secret")] string? secret,
            CancellationToken ct)
        {
            var server = await AuthAsync(body.AgentKey, secret ?? body.Secret, ct);
            if (server is null) return Unauthorized(new { message = "Invalid agent key or secret." });

            var device = await _db.Devices.FirstOrDefaultAsync(d => d.DeviceId == id && d.BranchId == server.BranchId, ct);
            if (device is null)
                return NotFound(new { message = $"Device {id} not found in this agent's branch." });

            if (!string.IsNullOrWhiteSpace(body.DeviceName)) device.DeviceName = body.DeviceName.Trim();
            if (!string.IsNullOrWhiteSpace(body.DeviceIP)) device.DeviceIP = body.DeviceIP.Trim();
            if (body.DevicePort > 0) device.DevicePort = body.DevicePort;
            if (body.CommPassword.HasValue) device.CommPassword = body.CommPassword.Value;
            if (body.SerialNumber is not null) device.SerialNumber = body.SerialNumber.Trim();
            if (body.DeviceModel is not null) device.DeviceModel = body.DeviceModel.Trim();
            if (body.IsActive.HasValue) device.IsActive = body.IsActive.Value;
            if (!string.IsNullOrWhiteSpace(body.Role) && Enum.TryParse<DeviceRole>(body.Role, true, out var role))
                device.Role = role;
            if (!string.IsNullOrWhiteSpace(body.DeviceType) && Enum.TryParse<DeviceType>(body.DeviceType, true, out var dt))
                device.DeviceType = dt;

            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                device.DeviceId,
                device.DeviceName,
                device.DeviceIP,
                device.DevicePort,
                device.CommPassword,
                device.SerialNumber,
                device.DeviceModel,
                role = device.Role.ToString(),
                deviceType = device.DeviceType.ToString(),
                device.IsActive,
                device.IsOnline,
                message = "Device updated successfully."
            });
        }

        // ── DELETE api/Agent/devices/{id} ────────────────────────────
        /// <summary>Allows an agent to delete/deactivate a device assigned to its branch.</summary>
        [HttpDelete("devices/{id:int}")]
        public async Task<IActionResult> DeleteDevice(
            int id,
            [FromQuery] string? agentKey,
            [FromQuery] string? secret,
            [FromHeader(Name = "X-Agent-Key")] string? headerKey,
            [FromHeader(Name = "X-Agent-Secret")] string? headerSecret,
            CancellationToken ct)
        {
            var key = !string.IsNullOrWhiteSpace(headerKey) ? headerKey : agentKey;
            var sec = !string.IsNullOrWhiteSpace(headerSecret) ? headerSecret : secret;

            var server = await AuthAsync(key, sec, ct);
            if (server is null) return Unauthorized(new { message = "Invalid agent key or secret." });

            var device = await _db.Devices.FirstOrDefaultAsync(d => d.DeviceId == id && d.BranchId == server.BranchId, ct);
            if (device is null)
                return NotFound(new { message = $"Device {id} not found in this agent's branch." });

            // Check if device has recorded attendance logs
            var hasLogs = await _db.AttendanceLogs.AnyAsync(l => l.DeviceId == id, ct);
            if (hasLogs)
            {
                // Soft-delete / deactivate to preserve historical attendance integrity
                device.IsActive = false;
                device.ModifiedDate = DateTime.Now;
                await _db.SaveChangesAsync(ct);

                return Ok(new
                {
                    deviceId = id,
                    softDeleted = true,
                    message = $"Device '{device.DeviceName}' has historical attendance logs and was deactivated to preserve records."
                });
            }
            else
            {
                // Clean up any employee-device mappings
                var links = await _db.EmployeeDevices.Where(ed => ed.DeviceId == id).ToListAsync(ct);
                if (links.Count > 0)
                {
                    _db.EmployeeDevices.RemoveRange(links);
                }

                _db.Devices.Remove(device);
                await _db.SaveChangesAsync(ct);

                return Ok(new
                {
                    deviceId = id,
                    softDeleted = false,
                    message = $"Device '{device.DeviceName}' deleted successfully."
                });
            }
        }

        // ── POST api/Agent/punches ───────────────────────────────────

        /// <summary>
        /// Receives a punch batch from the agent and inserts into AttendanceLogs.
        ///
        /// IDEMPOTENT: the unique index IX_AttendanceLog_Unique on
        /// (BiometricUserId, AttendanceTime, DeviceId) means the same punch
        /// sent twice is treated as a duplicate, not an error. The agent
        /// delivers at-least-once; duplicates are safe.
        /// </summary>
        [HttpPost("punches")]
        public async Task<IActionResult> Punches(
            [FromBody] AgentPunchBatchRequest body,
            [FromHeader(Name = "X-Agent-Secret")] string? secret,
            CancellationToken ct)
        {
            var server = await AuthAsync(body.AgentKey, secret, ct);
            if (server is null)
            {
                _logger.LogWarning("Punch batch rejected (bad auth). AgentKey={Key}", body.AgentKey);
                return Unauthorized(new { message = "Invalid agent key or secret." });
            }

            if (body.Punches is null || body.Punches.Count == 0)
                return Ok(new { accepted = 0, duplicates = 0, rejected = 0 });

            // Pre-resolve biometric IDs → EmployeeId once for the whole batch.
            var deviceMap = await _db.EmployeeDevices
                .Where(ed => ed.IsActive)
                .ToDictionaryAsync(ed => (ed.BiometricUserId, ed.DeviceId), ed => ed.EmployeeId, ct);

            var directMap = await _db.Employees
                .Where(e => e.IsActive && !string.IsNullOrEmpty(e.BiometricUserId))
                .ToDictionaryAsync(e => e.BiometricUserId!, e => e.EmployeeId, ct);

            var accepted  = 0;
            var duplicates = 0;
            var rejected   = 0;

            // Insert one row at a time so a duplicate constraint on one punch
            // does not roll back the entire batch.
            foreach (var p in body.Punches)
            {
                int? employeeId = null;
                if (deviceMap.TryGetValue((p.BiometricUserId, p.DeviceId), out var mapped))
                    employeeId = mapped;
                else if (directMap.TryGetValue(p.BiometricUserId, out var direct))
                    employeeId = direct;

                _db.AttendanceLogs.Add(new AttendanceLog
                {
                    BiometricUserId = p.BiometricUserId,
                    EmployeeId      = employeeId,
                    DeviceId        = p.DeviceId,
                    BranchId        = server.BranchId,
                    AttendanceTime  = p.PunchTime,
                    AttendanceType  = DescribeInOut(p.InOutMode),
                    VerifyMethod    = DescribeVerify(p.VerifyMode),
                    WorkCode        = p.WorkCode,
                    IsSynced        = true,
                    SyncedDate      = DateTime.Now,
                    IsProcessed     = false,
                    IsManual        = false,
                    CreatedDate     = DateTime.Now
                });

                try
                {
                    await _db.SaveChangesAsync(ct);
                    accepted++;
                }
                catch (DbUpdateException ex) when (IsUniqueViolation(ex))
                {
                    _db.ChangeTracker.Clear();
                    duplicates++;
                }
                catch (Exception ex)
                {
                    _db.ChangeTracker.Clear();
                    _logger.LogWarning(ex, "Could not save punch {UserId} @ {Time}", p.BiometricUserId, p.PunchTime);
                    rejected++;
                }
            }

            _logger.LogInformation(
                "Agent {Key}: {Total} punch(es) received — {A} accepted, {D} duplicate, {R} rejected",
                server.AgentKey, body.Punches.Count, accepted, duplicates, rejected);

            return Ok(new { accepted, duplicates, rejected });
        }

        // ── GET api/Agent/summary ────────────────────────────────────

        /// <summary>Daily punch count for the agent's branch — shown on the agent status page.</summary>
        [HttpGet("summary")]
        public async Task<IActionResult> Summary(
            [FromQuery] string agentKey,
            [FromQuery] string secret,
            [FromQuery] DateTime? date,
            CancellationToken ct)
        {
            var server = await AuthAsync(agentKey, secret, ct);
            if (server is null) return Unauthorized(new { message = "Invalid agent key or secret." });

            var day  = (date ?? DateTime.Today).Date;
            var next = day.AddDays(1);

            var count = await _db.AttendanceLogs
                .Where(a => a.BranchId == server.BranchId
                         && a.AttendanceTime >= day
                         && a.AttendanceTime < next)
                .CountAsync(ct);

            return Ok(new { date = day, branchId = server.BranchId, punchCount = count });
        }

        // ── helpers ──────────────────────────────────────────────────

        private static string DescribeInOut(int mode) => mode switch
        {
            0 => "CheckIn", 1 => "CheckOut",
            2 => "BreakOut", 3 => "BreakIn",
            4 => "OvertimeIn", 5 => "OvertimeOut",
            _ => "Unknown"
        };

        private static string DescribeVerify(int mode) => mode switch
        {
            0 => "Password", 1 => "Fingerprint",
            2 => "Card", 15 => "Face",
            _ => "Other"
        };

        private static bool IsUniqueViolation(DbUpdateException ex) =>
            ex.InnerException is Microsoft.Data.SqlClient.SqlException sql &&
            (sql.Number == 2601 || sql.Number == 2627);
    }

    // ── request DTOs ─────────────────────────────────────────────────

    public record AgentLoginRequest(string AgentKey, string Secret, string? AgentVersion);
    public record AgentHeartbeatRequest(string AgentKey, string Secret);

    public record AgentPunchItem(
        string BiometricUserId,
        int DeviceId,
        DateTime PunchTime,
        int VerifyMode,
        int InOutMode,
        int WorkCode);

    public record AgentPunchBatchRequest(
        string AgentKey,
        List<AgentPunchItem> Punches);

    public record AgentCreateDeviceRequest(
        string AgentKey,
        string? Secret,
        string DeviceName,
        string DeviceIP,
        int DevicePort = 4370,
        int CommPassword = 0,
        string? SerialNumber = null,
        string? DeviceModel = null,
        string? Role = "Slave",
        string DeviceType = "ZkTeco",
        bool? IsActive = true);

    public record AgentUpdateDeviceRequest(
        string AgentKey,
        string? Secret,
        string? DeviceName,
        string? DeviceIP,
        int DevicePort = 0,
        int? CommPassword = null,
        string? SerialNumber = null,
        string? DeviceModel = null,
        string? Role = null,
        string? DeviceType = null,
        bool? IsActive = null);
}
