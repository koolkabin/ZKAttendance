using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ZKAttendance.Agent.Data;
using ZKAttendance.Agent.Services;

namespace ZKAttendance.Agent.Controllers
{
    /// <summary>
    /// The agent's own API, used by its local page.
    ///
    /// No authentication. This runs on a machine inside the office and is not
    /// exposed to the internet; the credential that matters is the agent
    /// secret it uses to talk to App1, which lives in config and never reaches
    /// the browser. If the agent is ever put on a public address, this needs a
    /// login in front of it.
    /// </summary>
    [Route("api/agent")]
    [ApiController]
    [Produces("application/json")]
    public class AgentController : ControllerBase
    {
        private readonly AgentDbContext _db;
        private readonly ICentralClient _central;
        private readonly IDeviceSyncService _sync;
        private readonly IConfiguration _config;
        private readonly ILogger<AgentController> _logger;

        public AgentController(
            AgentDbContext db,
            ICentralClient central,
            IDeviceSyncService sync,
            IConfiguration config,
            ILogger<AgentController> logger)
        {
            _db = db;
            _central = central;
            _sync = sync;
            _config = config;
            _logger = logger;
        }

        /// <summary>Is the agent configured, and can it see App1?</summary>
        [HttpGet("status")]
        public async Task<IActionResult> Status(CancellationToken ct)
        {
            var configured = !string.IsNullOrWhiteSpace(_config["Central:AgentKey"])
                             && !string.IsNullOrWhiteSpace(_config["Central:Secret"]);

            if (!configured)
            {
                return Ok(new
                {
                    configured = false,
                    connected = false,
                    message = "No agent key set. Register an agent in App1, then paste its key and secret into appsettings.json."
                });
            }

            var login = await _central.LoginAsync(ct);

            var pending = await _db.OutboxPunches.CountAsync(o => o.Status == OutboxStatus.Pending, ct);
            var dead = await _db.OutboxPunches.CountAsync(o => o.Status == OutboxStatus.Dead, ct);
            var sent = await _db.OutboxPunches.CountAsync(o => o.Status == OutboxStatus.Sent, ct);

            return Ok(new
            {
                configured = true,
                connected = login is not null,
                centralUrl = _config["Central:BaseUrl"],
                serverName = login?.ServerName,
                branchName = login?.BranchName,
                serverTime = login?.ServerTime,
                outbox = new { pending, sent, dead },
                message = login is null
                    ? "Cannot reach the central server. Check the URL, the network, and that the key is still valid."
                    : "Connected."
            });
        }

        /// <summary>Devices App1 says this agent is responsible for.</summary>
        [HttpGet("devices")]
        public async Task<IActionResult> Devices(CancellationToken ct)
        {
            var list = await _central.GetDevicesAsync(ct);
            if (list is null)
                return StatusCode(502, new { message = "Could not fetch the device list from the central server." });

            return Ok(list);
        }

        /// <summary>Add a device for this agent's branch via central server.</summary>
        [HttpPost("devices")]
        public async Task<IActionResult> CreateDevice([FromBody] CreateDeviceRequest request, CancellationToken ct)
        {
            var (ok, device, error) = await _central.CreateDeviceAsync(request, ct);
            if (!ok) return BadRequest(new { message = error ?? "Failed to create device" });
            return Ok(device);
        }

        /// <summary>Update device settings via central server.</summary>
        [HttpPut("devices/{id:int}")]
        public async Task<IActionResult> UpdateDevice(int id, [FromBody] UpdateDeviceRequest request, CancellationToken ct)
        {
            var (ok, device, error) = await _central.UpdateDeviceAsync(id, request, ct);
            if (!ok) return BadRequest(new { message = error ?? "Failed to update device" });
            return Ok(device);
        }

        /// <summary>Delete or deactivate a device via central server.</summary>
        [HttpDelete("devices/{id:int}")]
        public async Task<IActionResult> DeleteDevice(int id, CancellationToken ct)
        {
            var (ok, message, error) = await _central.DeleteDeviceAsync(id, ct);
            if (!ok) return BadRequest(new { message = error ?? "Failed to delete device" });
            return Ok(new { success = true, message });
        }

        /// <summary>Test connection to device over LAN directly from this agent.</summary>
        [HttpPost("devices/{id:int}/test-connection")]
        public async Task<IActionResult> TestConnection(int id, CancellationToken ct)
        {
            var result = await _sync.TestDeviceAsync(id, ct);
            return Ok(result);
        }

        public record SyncApiRequest(DateTime? FromDate = null, DateTime? ToDate = null);

        /// <summary>
        /// Read one device and queue what it holds. Supports optional date range.
        /// </summary>
        [HttpPost("sync/{deviceId:int}")]
        public async Task<IActionResult> Sync(int deviceId, [FromBody] SyncApiRequest? request = null, CancellationToken ct = default)
        {
            var run = await _sync.SyncDeviceAsync(deviceId, User.Identity?.Name ?? "local", request?.FromDate, request?.ToDate, ct);

            return Ok(new
            {
                run.SyncRunId,
                run.DeviceName,
                run.Status,
                run.RecordsRead,
                run.RecordsQueued,
                recordsStaged = run.RecordsQueued,
                run.Message,
                run.StartedAt,
                run.FinishedAt
            });
        }

        /// <summary>Recent sync runs with breakdown of staged, sent, and failed records.</summary>
        [HttpGet("runs")]
        public async Task<IActionResult> Runs(CancellationToken ct)
        {
            var runs = await _db.SyncRuns
                .OrderByDescending(r => r.SyncRunId)
                .Take(50)
                .ToListAsync(ct);

            var runIds = runs.Select(r => (long?)r.SyncRunId).ToList();

            var punchStats = await _db.OutboxPunches
                .Where(p => p.SyncRunId != null && runIds.Contains(p.SyncRunId))
                .GroupBy(p => p.SyncRunId)
                .Select(g => new
                {
                    SyncRunId = g.Key!.Value,
                    Sent = g.Count(p => p.Status == OutboxStatus.Sent),
                    Dead = g.Count(p => p.Status == OutboxStatus.Dead),
                    Pending = g.Count(p => p.Status == OutboxStatus.Pending)
                })
                .ToDictionaryAsync(x => x.SyncRunId, ct);

            var result = runs.Select(r =>
            {
                punchStats.TryGetValue(r.SyncRunId, out var stats);
                return new
                {
                    r.SyncRunId,
                    r.DeviceId,
                    r.DeviceName,
                    r.StartedAt,
                    r.FinishedAt,
                    r.Status,
                    r.RecordsRead,
                    recordsStaged = r.RecordsQueued,
                    recordsSent = stats?.Sent ?? 0,
                    recordsDead = stats?.Dead ?? 0,
                    recordsPending = stats?.Pending ?? 0,
                    r.Message,
                    r.TriggeredBy
                };
            });

            return Ok(result);
        }

        /// <summary>Details of one sync run including the staged punch list.</summary>
        [HttpGet("runs/{id:long}")]
        public async Task<IActionResult> RunDetails(long id, CancellationToken ct)
        {
            var run = await _db.SyncRuns.FirstOrDefaultAsync(r => r.SyncRunId == id, ct);
            if (run is null) return NotFound(new { message = $"Sync run {id} not found." });

            var punches = await _db.OutboxPunches
                .Where(p => p.SyncRunId == id)
                .OrderByDescending(p => p.OutboxId)
                .Take(200)
                .Select(p => new
                {
                    p.OutboxId,
                    p.BiometricUserId,
                    p.DeviceId,
                    p.PunchTime,
                    status = p.Status.ToString(),
                    p.Attempts,
                    p.LastError,
                    p.SentAt,
                    p.CreatedAt
                })
                .ToListAsync(ct);

            var sent = punches.Count(p => p.status == "Sent");
            var dead = punches.Count(p => p.status == "Dead");
            var pending = punches.Count(p => p.status == "Pending");

            return Ok(new
            {
                run.SyncRunId,
                run.DeviceId,
                run.DeviceName,
                run.StartedAt,
                run.FinishedAt,
                run.Status,
                run.RecordsRead,
                recordsStaged = run.RecordsQueued,
                recordsSent = sent,
                recordsDead = dead,
                recordsPending = pending,
                run.Message,
                run.TriggeredBy,
                punches
            });
        }

        /// <summary>What is still waiting to reach App1.</summary>
        [HttpGet("outbox")]
        public async Task<IActionResult> Outbox([FromQuery] string status = "Pending", CancellationToken ct = default)
        {
            var query = _db.OutboxPunches.AsQueryable();

            if (Enum.TryParse<OutboxStatus>(status, true, out var parsed))
                query = query.Where(o => o.Status == parsed);

            var rows = await query
                .OrderByDescending(o => o.OutboxId)
                .Take(200)
                .Select(o => new
                {
                    o.OutboxId,
                    o.BiometricUserId,
                    o.DeviceId,
                    o.PunchTime,
                    status = o.Status.ToString(),
                    o.Attempts,
                    o.NextAttemptAt,
                    o.LastError,
                    o.CreatedAt,
                    o.SentAt
                })
                .ToListAsync(ct);

            return Ok(new
            {
                pending = await _db.OutboxPunches.CountAsync(o => o.Status == OutboxStatus.Pending, ct),
                sent = await _db.OutboxPunches.CountAsync(o => o.Status == OutboxStatus.Sent, ct),
                dead = await _db.OutboxPunches.CountAsync(o => o.Status == OutboxStatus.Dead, ct),
                rows
            });
        }

        /// <summary>
        /// Push the outbox now instead of waiting for the timer. Useful after
        /// the internet has just come back.
        /// </summary>
        [HttpPost("outbox/drain")]
        public async Task<IActionResult> Drain(
            [FromServices] ILoggerFactory loggerFactory,
            [FromServices] IServiceScopeFactory scopes,
            CancellationToken ct)
        {
            var worker = new OutboxDrainService(scopes, _config, loggerFactory.CreateLogger<OutboxDrainService>());
            await worker.DrainOnceAsync(_db, _central, 200, ct);

            return Ok(new
            {
                pending = await _db.OutboxPunches.CountAsync(o => o.Status == OutboxStatus.Pending, ct),
                message = "Drain attempted."
            });
        }

        /// <summary>
        /// Put dead rows back in the queue, for instance after fixing the
        /// mapping in App1 that caused them to be rejected.
        /// </summary>
        [HttpPost("outbox/retry-dead")]
        public async Task<IActionResult> RetryDead(CancellationToken ct)
        {
            var dead = await _db.OutboxPunches.Where(o => o.Status == OutboxStatus.Dead).ToListAsync(ct);

            foreach (var row in dead)
            {
                row.Status = OutboxStatus.Pending;
                row.Attempts = 0;
                row.NextAttemptAt = null;
                row.LastError = null;
            }

            await _db.SaveChangesAsync(ct);
            return Ok(new { requeued = dead.Count });
        }

        /// <summary>Clear simulated or test records from the outbox buffer.</summary>
        [HttpPost("outbox/clear")]
        public async Task<IActionResult> ClearOutbox(CancellationToken ct)
        {
            var count = await _db.OutboxPunches.CountAsync(ct);
            _db.OutboxPunches.RemoveRange(_db.OutboxPunches);
            await _db.SaveChangesAsync(ct);
            return Ok(new { cleared = count, message = $"Cleared {count} records from outbox." });
        }

        /// <summary>A short summary from App1, so the office can sanity-check today.</summary>
        [HttpGet("summary")]
        public async Task<IActionResult> Summary([FromQuery] DateTime? date, CancellationToken ct)
        {
            var client = HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>()
                                    .CreateClient(CentralClient.HttpClientName);
            try
            {
                var url = $"api/Agent/summary?agentKey={Uri.EscapeDataString(_config["Central:AgentKey"] ?? "")}" +
                          $"&secret={Uri.EscapeDataString(_config["Central:Secret"] ?? "")}" +
                          (date.HasValue ? $"&date={date:yyyy-MM-dd}" : "");

                var json = await client.GetStringAsync(url, ct);
                return Content(json, "application/json");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not fetch the summary");
                return StatusCode(502, new { message = "Could not reach the central server." });
            }
        }
    }

    public record AgentLoginBody(string Username, string Password);

    /// <summary>
    /// Sign-in for the agent's own page.
    ///
    /// The credentials are checked by App1, not here. The agent has no user
    /// table of its own, which is the point: one place to add or remove a
    /// person, and no second password to keep in step.
    ///
    /// The token returned is App1's, so it also proves the person is real if
    /// the agent ever needs to call App1 on their behalf.
    /// </summary>
    [Route("api/agent")]
    [ApiController]
    [Produces("application/json")]
    public class AgentAuthController : ControllerBase
    {
        private readonly IHttpClientFactory _factory;
        private readonly ILogger<AgentAuthController> _logger;

        public AgentAuthController(IHttpClientFactory factory, ILogger<AgentAuthController> logger)
        {
            _factory = factory;
            _logger = logger;
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] AgentLoginBody body, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrWhiteSpace(body.Password))
                return BadRequest(new { message = "Enter a username and password." });

            var client = _factory.CreateClient(Services.CentralClient.HttpClientName);

            try
            {
                var response = await client.PostAsJsonAsync("api/Auth/login",
                    new { username = body.Username, password = body.Password }, ct);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Login refused for {User}", body.Username);
                    return Unauthorized(new { message = "Username or password is not correct." });
                }

                var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);

                // App1 has changed its login shape before, so read defensively
                // rather than binding to a DTO that might not match.
                string? Read(params string[] names)
                {
                    foreach (var n in names)
                        if (payload.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String)
                            return v.GetString();
                    return null;
                }

                return Ok(new
                {
                    token = Read("token", "accessToken", "jwt") ?? "",
                    username = Read("username", "userName") ?? body.Username,
                    role = Read("role") ?? "User"
                });
            }
            catch (Exception ex)
            {
                // A login failure and an unreachable server are different
                // problems, and the person needs to know which one this is.
                _logger.LogWarning(ex, "Could not reach the central server to sign in");
                return StatusCode(502, new
                {
                    message = "Cannot reach the central server, so sign-in is not possible. Check the network and Central:BaseUrl."
                });
            }
        }
    }
}
