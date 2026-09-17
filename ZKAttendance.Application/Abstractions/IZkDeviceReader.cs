using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using ZKAttendance.Domain.Enums;

namespace ZKAttendance.Application.Abstractions
{
    /// <summary>One punch exactly as the device reports it.</summary>
    public record DevicePunch(
        string BiometricUserId,
        DateTime PunchTime,
        int VerifyMode,      // 0 password, 1 fingerprint, 2 card
        int InOutMode,       // 0 in, 1 out, 2 break-out, 3 break-in, 4/5 OT in/out
        int WorkCode);

    /// <summary>One user record stored on the device.</summary>
    public record DeviceUser(string BiometricUserId, string Name, int Privilege, bool Enabled)
    {
        /// <summary>
        /// The device's internal slot number. Distinct from BiometricUserId:
        /// the enrol number is what the operator types and what appears in
        /// punches, the Uid is the row the firmware stores it in. Template
        /// reads and writes address the Uid, not the enrol number.
        /// </summary>
        public int Uid { get; init; }

        /// <summary>How many fingers this user has enrolled, when known.</summary>
        public int FingerCount { get; init; }
    }

    /// <summary>
    /// One enrolled finger. <paramref name="FormatVersion"/> is 9 or 10 —
    /// ZKTeco firmware families use incompatible template encodings, and a v10
    /// template written to a v9 terminal will never match. Carrying the version
    /// lets propagation refuse loudly instead of failing silently at the door.
    /// </summary>
    public record FingerTemplate(
        string BiometricUserId,
        int FingerIndex,
        byte[] Data,
        int FormatVersion = 10)
    {
        public int Uid { get; init; }
        public bool Valid { get; init; } = true;
    }

    public record DeviceInfo(
        string SerialNumber,
        string FirmwareVersion,
        int UserCount,
        int LogCount,
        DateTime DeviceTime);

    /// <summary>Outcome of asking a terminal to start capturing a finger.</summary>
    public record EnrollResult(bool Started, string Message, int FingerIndex);

    /// <summary>
    /// Core interface that every attendance terminal reader must implement:
    /// connecting, fetching diagnostic info, synchronizing clock, and reading punch logs.
    /// </summary>
    public interface IAttendanceDeviceReader : IDisposable
    {
        /// <param name="commPassword">The device Comm Key. 0 = none.</param>
        Task<bool> ConnectAsync(string ip, int port, int commPassword = 0);
        Task DisconnectAsync();

        Task<DeviceInfo?> GetDeviceInfoAsync();

        /// <summary>Push server time to the device so branch clocks stay aligned.</summary>
        Task<bool> SetDeviceTimeAsync(DateTime serverTime);

        /// <summary>
        /// All attendance records currently in device memory.
        /// </summary>
        Task<List<DevicePunch>> GetAttendanceLogsAsync(DateTime? since = null);
    }

    /// <summary>
    /// Optional capability interface for devices that support user queries,
    /// creating user records on the machine, and deleting users.
    /// </summary>
    public interface IDeviceUserManager
    {
        /// <summary>All users enrolled on this device.</summary>
        Task<List<DeviceUser>> GetUsersAsync();

        /// <summary>
        /// Create or overwrite the user record on the terminal.
        /// </summary>
        Task<bool> SetUserAsync(
            string biometricUserId,
            string name,
            int privilege = 0,
            string password = "",
            bool enabled = true);

        /// <summary>Remove the user and their templates from this terminal.</summary>
        Task<bool> DeleteUserAsync(string biometricUserId);

        /// <summary>
        /// Ask the terminal to reload its user table from flash.
        /// </summary>
        Task<bool> RefreshDataAsync();
    }

    /// <summary>
    /// Optional capability interface for devices that support remote biometric enrollment
    /// (triggering fingerprint sensor / face camera) and reading/writing biometric templates.
    /// </summary>
    public interface IDeviceBiometricManager
    {
        /// <summary>
        /// Put the terminal into enrolment mode for this user, so the screen
        /// switches to "place your finger" / "look at the camera".
        /// </summary>
        Task<EnrollResult> StartRemoteEnrollAsync(string biometricUserId, int fingerIndex = 0);

        /// <summary>Abort an enrolment or verification the terminal is waiting on.</summary>
        Task<bool> CancelCaptureAsync();

        /// <summary>
        /// Read enrolled templates back off the terminal.
        /// </summary>
        Task<List<FingerTemplate>> GetTemplatesAsync(string? biometricUserId = null);

        /// <summary>Write one cached template onto this terminal.</summary>
        Task<bool> SetTemplateAsync(FingerTemplate template);
    }

    /// <summary>
    /// Composite interface combining core attendance reading, user management, and biometric enrollment.
    /// Retained for full backward compatibility.
    /// </summary>
    public interface IZkDeviceReader : IAttendanceDeviceReader, IDeviceUserManager, IDeviceBiometricManager
    {
    }
}
