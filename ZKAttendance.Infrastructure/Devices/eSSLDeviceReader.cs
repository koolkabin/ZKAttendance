using ZKAttendance.Application.Abstractions;
namespace ZKAttendance.Infrastructure.Devices
{
    // =========================================================
    // STUB — replace with real vendor protocol implementation.
    // All IZkDeviceReader methods return safe no-op defaults
    // so the sync pipeline can start; they will just produce
    // empty results until the vendor-specific code is filled in.
    // =========================================================
        /// <summary>eSSL biometric device reader via HTTP API or SDK.
    /// TODO: implement with the vendor SDK or HTTP API.
    /// Configuration section: eSSL in appsettings.json
    /// </summary>
    public sealed class eSSLDeviceReader : IZkDeviceReader
    {
        private readonly ILogger<eSSLDeviceReader> _logger;
        public eSSLDeviceReader(ILogger<eSSLDeviceReader> logger) => _logger = logger;

        public Task<bool> ConnectAsync(string ip, int port, int commPassword = 0)
        {
            _logger.LogWarning("eSSLDeviceReader.ConnectAsync not yet implemented for {IP}", ip);
            return Task.FromResult(false);
        }
        public Task DisconnectAsync() => Task.CompletedTask;
        public Task<DeviceInfo?> GetDeviceInfoAsync() => Task.FromResult<DeviceInfo?>(null);
        public Task<bool> SetDeviceTimeAsync(DateTime t) => Task.FromResult(false);
        public Task<List<DeviceUser>> GetUsersAsync() => Task.FromResult(new List<DeviceUser>());
        public Task<List<DevicePunch>> GetAttendanceLogsAsync(DateTime? since = null) => Task.FromResult(new List<DevicePunch>());
        public Task<bool> SetUserAsync(string id, string name, int priv = 0, string pwd = "", bool enabled = true) => Task.FromResult(false);
        public Task<bool> DeleteUserAsync(string id) => Task.FromResult(false);
        public Task<EnrollResult> StartRemoteEnrollAsync(string id, int finger = 0) =>
            Task.FromResult(new EnrollResult(false, "Not implemented for eSSLDeviceReader", finger));
        public Task<bool> CancelCaptureAsync() => Task.FromResult(false);
        public Task<List<FingerTemplate>> GetTemplatesAsync(string? id = null) => Task.FromResult(new List<FingerTemplate>());
        public Task<bool> SetTemplateAsync(FingerTemplate t) => Task.FromResult(false);
        public Task<bool> RefreshDataAsync() => Task.FromResult(false);
        public void Dispose() { }
    }
}
