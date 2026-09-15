using Microsoft.EntityFrameworkCore;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Infrastructure.Services.Employees
{
    public class EmployeeDeviceEnrollment : IEmployeeDeviceEnrollment
    {
        private readonly AttendanceDbContext _context;
        private readonly ILogger<EmployeeDeviceEnrollment> _logger;

        public EmployeeDeviceEnrollment(
            AttendanceDbContext context,
            ILogger<EmployeeDeviceEnrollment> logger)
        {
            _context = context;
            _logger = logger;
        }

        public async Task<IReadOnlyList<DeviceAssignment>> AssignAsync(
            int employeeId,
            IEnumerable<int> deviceIds,
            IDictionary<int, string>? deviceUserIds = null,
            CancellationToken ct = default)
        {
            var employee = await _context.Employees
                .AsNoTracking()
                .FirstOrDefaultAsync(e => e.EmployeeId == employeeId, ct)
                ?? throw new InvalidOperationException($"Employee {employeeId} not found");

            var existing = await _context.EmployeeDevices
                .Where(ed => ed.EmployeeId == employeeId)
                .ToListAsync(ct);

            // Remember the number already recorded per device before deleting,
            // so a branch-specific ID is not lost just because the caller did
            // not repeat it in this request.
            var previous = existing.ToDictionary(ed => ed.DeviceId, ed => ed.BiometricUserId);

            _context.EmployeeDevices.RemoveRange(existing);

            var result = new List<DeviceAssignment>();

            foreach (var deviceId in deviceIds.Distinct())
            {
                var supplied = deviceUserIds is not null
                                && deviceUserIds.TryGetValue(deviceId, out var given)
                                && !string.IsNullOrWhiteSpace(given)
                    ? given.Trim()
                    : null;

                var kept = previous.TryGetValue(deviceId, out var old)
                           && !string.IsNullOrWhiteSpace(old) ? old : null;

                // Prefer explicit supplied ID, then current employee BiometricUserId, then kept legacy ID
                var deviceUserId = supplied 
                    ?? (!string.IsNullOrWhiteSpace(employee.BiometricUserId) ? employee.BiometricUserId : kept)
                    ?? throw new InvalidOperationException($"No biometric ID available for employee {employeeId} on device {deviceId}");

                // On one device an enrol number belongs to exactly one person.
                var clash = await _context.EmployeeDevices
                    .AnyAsync(ed => ed.DeviceId == deviceId
                                 && ed.BiometricUserId == deviceUserId
                                 && ed.EmployeeId != employeeId, ct);

                if (clash)
                    throw new InvalidOperationException(
                        $"Enrol number '{deviceUserId}' is already used by another employee " +
                        $"on device {deviceId}. Supply a different DeviceUserIds entry for it.");

                var link = new EmployeeDevice
                {
                    EmployeeId = employeeId,
                    DeviceId = deviceId,
                    BiometricUserId = deviceUserId,
                    IsEnrolled = previous.ContainsKey(deviceId),
                    EnrolledDate = previous.ContainsKey(deviceId) ? DateTime.Now : null,
                    IsActive = true,
                    CreatedDate = DateTime.Now
                };

                _context.EmployeeDevices.Add(link);
                result.Add(new DeviceAssignment(deviceId, deviceUserId, link.IsEnrolled));

                // Retroactively attribute punches for this biometric user on this device
                var unmapped = await _context.AttendanceLogs
                    .Where(a => a.DeviceId == deviceId && a.BiometricUserId == deviceUserId && a.EmployeeId == null)
                    .ToListAsync(ct);
                foreach (var p in unmapped)
                    p.EmployeeId = employeeId;
            }

            await _context.SaveChangesAsync(ct);

            _logger.LogInformation(
                "Employee {Id} linked to {Count} device(s)", employeeId, result.Count);

            return result;
        }

        public async Task<IReadOnlyList<DeviceAssignment>> GetForEmployeeAsync(
            int employeeId, CancellationToken ct = default)
        {
            var links = await _context.EmployeeDevices
                .AsNoTracking()
                .Where(ed => ed.EmployeeId == employeeId && ed.IsActive)
                .ToListAsync(ct);

            return links
                .Select(l => new DeviceAssignment(l.DeviceId, l.BiometricUserId, l.IsEnrolled))
                .ToList();
        }
    }
}
