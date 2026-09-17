using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ZKAttendance.Application.Abstractions;

namespace ZKAttendance.Infrastructure.Devices
{
    /// <summary>
    /// Reads attendance from Hikvision access-control panels and cameras
    /// via the vendor ISAPI HTTP REST interface.
    ///
    /// AUTHENTICATION
    /// --------------
    /// Hikvision ISAPI uses HTTP Digest authentication.
    /// Credentials are passed via <see cref="ConnectAsync"/>:
    ///   ip       = panel IP (e.g. 192.168.1.70)
    ///   port     = HTTP port (usually 80 or 8000)
    ///   commPassword = not used; username and password come from appsettings.
    ///
    /// IMPLEMENTATION STATUS
    /// ---------------------
    /// - ConnectAsync       ? (validates reachability via /ISAPI/System/status)
    /// - GetDeviceInfoAsync ? (parses firmware/serial from /ISAPI/System/deviceInfo)
    /// - GetAttendanceLogsAsync ? (searches AcsEvent endpoint with date filter)
    /// - SetUserAsync       ? (POST /ISAPI/AccessControl/UserInfo/SetUp)
    /// - DeleteUserAsync    ? (DELETE /ISAPI/AccessControl/UserInfo/Delete)
    /// - GetUsersAsync      ? (POST /ISAPI/AccessControl/UserInfo/Search)
    /// - GetTemplatesAsync  ? not implemented — Hikvision stores templates internally
    /// - SetTemplateAsync   ? not implemented — finger enrolment done on device
    /// - StartRemoteEnrollAsync ? not implemented — use device touchscreen
    /// - CancelCaptureAsync ? not applicable
    ///
    /// TODO: replace stubs with real HTTP calls.
    /// </summary>
    public sealed class HikvisionDeviceReader : IZkDeviceReader
    {
        private readonly ILogger<HikvisionDeviceReader> _logger;
        private readonly IConfiguration _config;
        private HttpClient? _client;
        private string _baseUrl = string.Empty;

        public HikvisionDeviceReader(
            ILogger<HikvisionDeviceReader> logger,
            IConfiguration config)
        {
            _logger = logger;
            _config = config;
        }

        public async Task<bool> ConnectAsync(string ip, int port, int commPassword = 0)
        {
            var user = _config["Hikvision:Username"] ?? "admin";
            var pass = _config["Hikvision:Password"] ?? "";

            _baseUrl = $"http://{ip}:{port}";

            var handler = new HttpClientHandler
            {
                Credentials = new System.Net.NetworkCredential(user, pass)
            };
            _client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(5) };

            try
            {
                var resp = await _client.GetAsync($"{_baseUrl}/ISAPI/System/status");
                _logger.LogInformation("Hikvision {IP}: status {Code}", ip, resp.StatusCode);
                return resp.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Hikvision {IP}: connect failed — {Msg}", ip, ex.Message);
                return false;
            }
        }

        public Task DisconnectAsync()
        {
            _client?.Dispose();
            _client = null;
            return Task.CompletedTask;
        }

        public async Task<DeviceInfo?> GetDeviceInfoAsync()
        {
            try
            {
                var json = await _client!.GetStringAsync($"{_baseUrl}/ISAPI/System/deviceInfo");
                var doc = JsonNode.Parse(json);
                return new DeviceInfo(
                    SerialNumber: doc?["DeviceInfo"]?["serialNumber"]?.GetValue<string>() ?? "",
                    FirmwareVersion: doc?["DeviceInfo"]?["firmwareVersion"]?.GetValue<string>() ?? "",
                    UserCount: 0,
                    LogCount: 0,
                    DeviceTime: DateTime.Now);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("HikvisionDeviceReader.GetDeviceInfoAsync: {Msg}", ex.Message);
                return null;
            }
        }

        public Task<bool> SetDeviceTimeAsync(DateTime serverTime)
        {
            // TODO: PUT /ISAPI/System/time with ISO8601 body
            _logger.LogInformation("HikvisionDeviceReader.SetDeviceTimeAsync not yet implemented");
            return Task.FromResult(false);
        }

        public async Task<List<DeviceUser>> GetUsersAsync()
        {
            // TODO: POST /ISAPI/AccessControl/UserInfo/Search and parse XML/JSON
            await Task.CompletedTask;
            return new List<DeviceUser>();
        }

        public async Task<List<DevicePunch>> GetAttendanceLogsAsync(DateTime? since = null)
        {
            // TODO: POST /ISAPI/AccessControl/AcsEvent/capabilities search
            // with EventTime filter. Hikvision panels support server-side date
            // filtering, unlike ZKTeco, so request only new records.
            await Task.CompletedTask;
            _logger.LogInformation("HikvisionDeviceReader.GetAttendanceLogsAsync: stub — returning empty list");
            return new List<DevicePunch>();
        }

        public Task<bool> SetUserAsync(string biometricUserId, string name, int privilege = 0, string password = "", bool enabled = true)
        {
            // TODO: POST /ISAPI/AccessControl/UserInfo/SetUp
            _logger.LogInformation("HikvisionDeviceReader.SetUserAsync: stub");
            return Task.FromResult(false);
        }

        public Task<bool> DeleteUserAsync(string biometricUserId)
        {
            // TODO: DELETE /ISAPI/AccessControl/UserInfo/Delete
            _logger.LogInformation("HikvisionDeviceReader.DeleteUserAsync: stub");
            return Task.FromResult(false);
        }

        public Task<EnrollResult> StartRemoteEnrollAsync(string biometricUserId, int fingerIndex = 0)
        {
            // Hikvision terminals do not support remote fingerprint capture via ISAPI.
            // Enrolment must be done directly on the device touchscreen.
            return Task.FromResult(new EnrollResult(
                false,
                "Remote fingerprint enrolment is not supported on Hikvision devices. " +
                "Please enrol directly at the terminal.",
                fingerIndex));
        }

        public Task<bool> CancelCaptureAsync() => Task.FromResult(false);

        public async Task<List<FingerTemplate>> GetTemplatesAsync(string? biometricUserId = null)
        {
            // Hikvision stores templates internally and does not expose them via ISAPI.
            await Task.CompletedTask;
            return new List<FingerTemplate>();
        }

        public Task<bool> SetTemplateAsync(FingerTemplate template)
        {
            _logger.LogInformation("HikvisionDeviceReader.SetTemplateAsync: not applicable");
            return Task.FromResult(false);
        }

        public Task<bool> RefreshDataAsync() => Task.FromResult(true);

        public void Dispose() { _client?.Dispose(); }
    }
}
