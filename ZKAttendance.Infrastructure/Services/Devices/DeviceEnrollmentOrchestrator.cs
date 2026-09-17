using Microsoft.EntityFrameworkCore;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Infrastructure.Services.Devices
{
    /// <summary>
    /// See <see cref="IDeviceEnrollmentOrchestrator"/> for the model.
    ///
    /// DESIGN RULES (mirroring AttendanceSyncService, for the same reasons)
    /// -------------------------------------------------------------------
    /// 1. One terminal failing must not stop the others. Every device is
    ///    wrapped in its own try/catch and contributes a row to the report
    ///    rather than throwing the whole operation away.
    /// 2. Partial success is reported, never hidden. "User created, finger
    ///    still to be enrolled here" is a real and common state; pretending a
    ///    device is done when its template write failed is how people end up
    ///    locked out of a branch office.
    /// 3. The database is the source of truth for WHO exists. The terminal is
    ///    the source of truth for WHAT a finger looks like. Neither overwrites
    ///    the other's half.
    /// </summary>
    public class DeviceEnrollmentOrchestrator : IDeviceEnrollmentOrchestrator
    {
        private readonly AttendanceDbContext _db;
        private readonly IDeviceReaderFactory _readerFactory;
        private readonly ILogger<DeviceEnrollmentOrchestrator> _logger;

        public DeviceEnrollmentOrchestrator(
            AttendanceDbContext db,
            IDeviceReaderFactory readerFactory,
            ILogger<DeviceEnrollmentOrchestrator> logger)
        {
            _db = db;
            _readerFactory = readerFactory;
            _logger = logger;
        }

        // ── status ──────────────────────────────────────────────────────

        public async Task<IReadOnlyList<DeviceEnrollmentState>> GetStatusAsync(
            int employeeId, CancellationToken ct = default)
        {
            var employee = await LoadEmployeeAsync(employeeId, ct);
            var devices = await ActiveDevicesAsync(ct);
            var links = await LinksAsync(employeeId, ct);

            var states = new List<DeviceEnrollmentState>();

            foreach (var device in devices)
            {
                var enrolNumber = EnrolNumberFor(links, device.DeviceId, employee);
                var state = await ProbeAsync(device, enrolNumber, ct);
                states.Add(state);
            }

            return states;
        }

        /// <summary>Ask one terminal what it knows about this enrol number.</summary>
        private async Task<DeviceEnrollmentState> ProbeAsync(
            Device device, string enrolNumber, CancellationToken ct)
        {
            using var reader = _readerFactory.Create(device.DeviceType);
            try
            {
                if (!await reader.ConnectAsync(device.DeviceIP, device.DevicePort, device.CommPassword))
                {
                    return new DeviceEnrollmentState(
                        device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                        Reachable: false, enrolNumber, UserOnDevice: false, TemplateCount: 0,
                        Message: "Could not reach the terminal.");
                }

                // The terminal answered, so it is online whatever happens next.
                // A firmware that will not do a bulk table read is a capability
                // limit, not a connectivity problem, and must not be reported as
                // "offline" - that sends people off checking network cables.
                bool onDevice = false;
                int templateCount = 0;
                string? note = null;

                if (reader is IDeviceUserManager userManager)
                {
                    try
                    {
                        var users = await userManager.GetUsersAsync();
                        onDevice = users.Any(u => u.BiometricUserId == enrolNumber);

                        var bioManager = reader as IDeviceBiometricManager;
                        var templates = (onDevice && bioManager != null)
                            ? await bioManager.GetTemplatesAsync(enrolNumber)
                            : new List<FingerTemplate>();
                        templateCount = templates.Count;

                        note = !onDevice
                            ? "Not on this terminal yet."
                            : templateCount == 0
                                ? "User created, no finger enrolled here yet."
                                : null;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex,
                            "Connected to {Device} but could not read its user table", device.DeviceName);
                        onDevice = false;
                        templateCount = 0;
                        note = "Connected, but this firmware will not list its users. Registration still works.";
                    }
                }
                else
                {
                    note = "This device type does not support remote user management.";
                }

                await reader.DisconnectAsync();

                return new DeviceEnrollmentState(
                    device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                    Reachable: true, enrolNumber, onDevice, templateCount, note);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Probe of device {Device} failed", device.DeviceName);
                return new DeviceEnrollmentState(
                    device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                    Reachable: false, enrolNumber, false, 0, ex.Message);
            }
        }

        // ── push the user record ────────────────────────────────────────

        public async Task<PropagationReport> PushUserToDevicesAsync(
            int employeeId, int? deviceId = null, CancellationToken ct = default)
        {
            var employee = await LoadEmployeeAsync(employeeId, ct);
            var devices = await ActiveDevicesAsync(ct);
            if (deviceId is { } id) devices = devices.Where(d => d.DeviceId == id).ToList();

            var links = await LinksAsync(employeeId, ct);
            var states = new List<DeviceEnrollmentState>();
            var warnings = new List<string>();
            int updated = 0, failed = 0;

            foreach (var device in devices)
            {
                var enrolNumber = EnrolNumberFor(links, device.DeviceId, employee);

                using var reader = _readerFactory.Create(device.DeviceType);
                try
                {
                    if (!await reader.ConnectAsync(device.DeviceIP, device.DevicePort, device.CommPassword))
                    {
                        failed++;
                        warnings.Add($"{device.DeviceName} is unreachable — the user was not created there.");
                        states.Add(Unreachable(device, enrolNumber));
                        continue;
                    }

                    if (reader is not IDeviceUserManager userManager)
                    {
                        failed++;
                        warnings.Add($"{device.DeviceName} does not support remote user provisioning.");
                        states.Add(new DeviceEnrollmentState(
                            device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                            true, enrolNumber, false, 0, "Device does not support remote user provisioning."));
                        continue;
                    }

                    var ok = await userManager.SetUserAsync(enrolNumber, employee.EmployeeName);
                    await reader.DisconnectAsync();

                    if (ok)
                    {
                        updated++;
                        await EnsureLinkAsync(employeeId, device.DeviceId, enrolNumber, enrolled: false, ct);
                        states.Add(new DeviceEnrollmentState(
                            device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                            true, enrolNumber, true, 0, "User created. Finger not enrolled yet."));
                    }
                    else
                    {
                        failed++;
                        warnings.Add($"{device.DeviceName} rejected the user write.");
                        states.Add(new DeviceEnrollmentState(
                            device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                            true, enrolNumber, false, 0, "The terminal rejected the user write."));
                    }
                }
                catch (Exception ex)
                {
                    failed++;
                    _logger.LogWarning(ex, "User push to {Device} failed", device.DeviceName);
                    warnings.Add($"{device.DeviceName}: {ex.Message}");
                    states.Add(Unreachable(device, enrolNumber, ex.Message));
                }
            }

            await _db.SaveChangesAsync(ct);

            return new PropagationReport(
                employeeId, employee.EmployeeName, 0, updated, failed, states, warnings);
        }

        // ── remote enrolment ────────────────────────────────────────────

        public async Task<StartEnrollmentResult> StartEnrollmentAsync(
            int employeeId, int? deviceId = null, int fingerIndex = 0, CancellationToken ct = default)
        {
            var employee = await LoadEmployeeAsync(employeeId, ct);
            var device = await ResolveEnrolmentDeviceAsync(deviceId, ct);

            var links = await LinksAsync(employeeId, ct);
            var enrolNumber = EnrolNumberFor(links, device.DeviceId, employee);

            // A person with no enrol number cannot be enrolled anywhere, and the
            // terminal's answer to being asked is an unhelpful protocol error.
            // Say so plainly instead.
            if (string.IsNullOrWhiteSpace(enrolNumber))
            {
                return new StartEnrollmentResult(false, device.DeviceId, device.DeviceName, "", fingerIndex,
                    $"{employee.EmployeeName} has no biometric / enrol number, so there is nothing for the terminal to register against. Set one on the employee first.");
            }

            using var reader = _readerFactory.Create(device.DeviceType);

            try
            {
                if (!await reader.ConnectAsync(device.DeviceIP, device.DevicePort, device.CommPassword))
                {
                    return new StartEnrollmentResult(false, device.DeviceId, device.DeviceName, enrolNumber, fingerIndex,
                        $"Could not reach {device.DeviceName} at {device.DeviceIP}:{device.DevicePort}. Check the terminal is powered on, on the same network, and that the comm key matches.");
                }

                // The terminal will refuse to enrol against a user it has never
                // heard of, so create the record first. This is also what makes
                // the person's name appear on the terminal's display while they
                // are standing at it.
                // Writing the user is idempotent - the terminal overwrites the
                // slot rather than duplicating it - so when the user table
                // cannot be listed, just write unconditionally instead of
                // giving up. Listing is an optimisation, not a precondition.
                var alreadyThere = false;
                if (reader is IDeviceUserManager userManager)
                {
                    try
                    {
                        var users = await userManager.GetUsersAsync();
                        alreadyThere = users.Any(u => u.BiometricUserId == enrolNumber);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex,
                            "Could not list users on {Device}; writing the user record anyway",
                            device.DeviceName);
                    }

                    if (!alreadyThere)
                    {
                        if (!await userManager.SetUserAsync(enrolNumber, employee.EmployeeName))
                        {
                            return new StartEnrollmentResult(false, device.DeviceId, device.DeviceName, enrolNumber, fingerIndex,
                                "The terminal would not accept the user record, so enrolment cannot start.");
                        }
                        await EnsureLinkAsync(employeeId, device.DeviceId, enrolNumber, enrolled: false, ct);
                        await _db.SaveChangesAsync(ct);
                    }
                }

                if (reader is not IDeviceBiometricManager bioManager)
                {
                    return new StartEnrollmentResult(false, device.DeviceId, device.DeviceName, enrolNumber, fingerIndex,
                        $"{device.DeviceName} ({device.DeviceType}) does not support remote enrollment triggering. Please enroll directly on the device.");
                }

                var result = await bioManager.StartRemoteEnrollAsync(enrolNumber, fingerIndex);

                return new StartEnrollmentResult(
                    result.Started, device.DeviceId, device.DeviceName, enrolNumber, fingerIndex,
                    result.Started
                        ? $"{device.DeviceName} is now showing the registration screen for {employee.EmployeeName} (enrol number {enrolNumber}). Ask them to scan now."
                        : result.Message);
            }
            catch (Exception ex)
            {
                // Anything the terminal throws at us is a device problem, not a
                // server fault. Report it as a failed start with the reason.
                _logger.LogWarning(ex, "Enrolment start failed on {Device} for employee {Id}",
                    device.DeviceName, employeeId);

                return new StartEnrollmentResult(false, device.DeviceId, device.DeviceName, enrolNumber, fingerIndex,
                    $"{device.DeviceName} did not accept the request: {ex.Message}");
            }
            finally
            {
                try { await reader.DisconnectAsync(); } catch { /* already gone */ }
            }
        }

        public async Task<bool> CancelEnrollmentAsync(
            int employeeId, int? deviceId = null, CancellationToken ct = default)
        {
            var device = await ResolveEnrolmentDeviceAsync(deviceId, ct);
            using var reader = _readerFactory.Create(device.DeviceType);
            try
            {
                if (!await reader.ConnectAsync(device.DeviceIP, device.DevicePort, device.CommPassword))
                    return false;
                if (reader is IDeviceBiometricManager bioManager)
                    return await bioManager.CancelCaptureAsync();
                return true;
            }
            catch (Exception ex)
            {
                // Cancelling is best-effort; the terminal times out on its own.
                _logger.LogDebug(ex, "Cancel on {Device} failed (non-fatal)", device.DeviceName);
                return false;
            }
            finally
            {
                try { await reader.DisconnectAsync(); } catch { /* already gone */ }
            }
        }

        // ── pull from master, push to the rest ──────────────────────────

        public async Task<PropagationReport> PullAndPropagateAsync(
            int employeeId, CancellationToken ct = default)
        {
            var employee = await LoadEmployeeAsync(employeeId, ct);
            var devices = await ActiveDevicesAsync(ct);
            var links = await LinksAsync(employeeId, ct);
            var warnings = new List<string>();

            var master = PickMaster(devices);
            if (master is null)
                throw new InvalidOperationException("No active device is available to enrol from.");

            // 1. Pull whatever the master now holds.
            var masterEnrolNumber = EnrolNumberFor(links, master.DeviceId, employee);
            var pulled = new List<FingerTemplate>();

            using (var reader = _readerFactory.Create(master.DeviceType))
            {
                try
                {
                    if (!await reader.ConnectAsync(master.DeviceIP, master.DevicePort, master.CommPassword))
                        throw new InvalidOperationException(
                            $"Could not reach the master terminal {master.DeviceName} at {master.DeviceIP}:{master.DevicePort}.");

                    if (reader is not IDeviceBiometricManager bioMaster)
                        throw new InvalidOperationException(
                            $"The master terminal {master.DeviceName} ({master.DeviceType}) does not support template retrieval.");

                    pulled = await bioMaster.GetTemplatesAsync(masterEnrolNumber);
                }
                catch (InvalidOperationException)
                {
                    throw;   // already a clear message; the controller turns it into a 400
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Template pull from master {Device} failed", master.DeviceName);
                    throw new InvalidOperationException(
                        $"Reading fingerprints from {master.DeviceName} failed: {ex.Message}");
                }
                finally
                {
                    try { await reader.DisconnectAsync(); } catch { /* already gone */ }
                }
            }

            if (pulled.Count == 0)
            {
                warnings.Add(
                    $"No fingerprint was found on {master.DeviceName} for enrol number {masterEnrolNumber}. " +
                    "Start enrolment and have the person scan before propagating.");
            }

            // 2. Cache them. This is what turns adding a fourth terminal into a
            //    background job instead of a day of calling people back.
            var cached = await CacheTemplatesAsync(employeeId, master.DeviceId, pulled, ct);

            await MarkEnrolledAsync(employeeId, master.DeviceId, masterEnrolNumber, pulled.Count > 0, ct);

            // 3. Write them to every other active terminal.
            var stored = await _db.FingerprintTemplates
                .Where(t => t.EmployeeId == employeeId)
                .ToListAsync(ct);

            var states = new List<DeviceEnrollmentState> { await ProbeAsync(master, masterEnrolNumber, ct) };
            int updated = 0, failed = 0;

            foreach (var device in devices.Where(d => d.DeviceId != master.DeviceId))
            {
                var enrolNumber = EnrolNumberFor(links, device.DeviceId, employee);
                var (state, ok) = await WriteEmployeeToDeviceAsync(device, employee, enrolNumber, stored, warnings, ct);
                states.Add(state);
                if (ok) updated++; else failed++;
            }

            await _db.SaveChangesAsync(ct);

            return new PropagationReport(
                employeeId, employee.EmployeeName, cached, updated, failed, states, warnings);
        }

        /// <summary>
        /// Write one employee — user record then templates — onto one terminal.
        /// Returns false when the finger did not make it, even if the user did,
        /// because a user without a template cannot open the door.
        /// </summary>
        private async Task<(DeviceEnrollmentState State, bool Ok)> WriteEmployeeToDeviceAsync(
            Device device,
            Employee employee,
            string enrolNumber,
            List<FingerprintTemplate> templates,
            List<string> warnings,
            CancellationToken ct)
        {
            using var reader = _readerFactory.Create(device.DeviceType);
            try
            {
                if (!await reader.ConnectAsync(device.DeviceIP, device.DevicePort, device.CommPassword))
                {
                    warnings.Add($"{device.DeviceName} is offline — it will be retried automatically.");
                    return (Unreachable(device, enrolNumber), false);
                }

                if (reader is not IDeviceUserManager userManager)
                {
                    warnings.Add($"{device.DeviceName} does not support user provisioning.");
                    await reader.DisconnectAsync();
                    return (new DeviceEnrollmentState(
                        device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                        true, enrolNumber, false, 0, "Device does not support remote user provisioning."), false);
                }

                if (!await userManager.SetUserAsync(enrolNumber, employee.EmployeeName))
                {
                    warnings.Add($"{device.DeviceName} rejected the user record.");
                    await reader.DisconnectAsync();
                    return (new DeviceEnrollmentState(
                        device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                        true, enrolNumber, false, 0, "The terminal rejected the user record."), false);
                }

                await EnsureLinkAsync(employee.EmployeeId, device.DeviceId, enrolNumber, enrolled: false, ct);

                var written = 0;
                if (reader is IDeviceBiometricManager bioManager)
                {
                    foreach (var t in templates)
                    {
                        var ok = await bioManager.SetTemplateAsync(new FingerTemplate(
                            enrolNumber, t.FingerIndex, t.TemplateData, t.TemplateFormatVersion));
                        if (ok) written++;
                    }
                }

                await reader.DisconnectAsync();

                if (templates.Count > 0 && written == 0)
                {
                    // Honest partial state rather than a false green tick.
                    warnings.Add(
                        $"{device.DeviceName}: the user was created but no fingerprint could be written. " +
                        "Enrol the finger directly on this terminal, or verify template transfer against this model.");
                    return (new DeviceEnrollmentState(
                        device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                        true, enrolNumber, true, 0,
                        "User created; fingerprint transfer failed. Enrol on this terminal."), false);
                }

                await MarkEnrolledAsync(employee.EmployeeId, device.DeviceId, enrolNumber, written > 0, ct);

                return (new DeviceEnrollmentState(
                    device.DeviceId, device.DeviceName, device.Role.ToString(), device.IsActive,
                    true, enrolNumber, true, written,
                    written > 0 ? null : "User created. No finger enrolled yet."), true);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Propagation to {Device} failed", device.DeviceName);
                warnings.Add($"{device.DeviceName}: {ex.Message}");
                return (Unreachable(device, enrolNumber, ex.Message), false);
            }
        }

        // ── provisioning and reconciliation ─────────────────────────────

        public async Task<int> ProvisionDeviceAsync(int deviceId, CancellationToken ct = default)
        {
            var device = await _db.Devices.FirstOrDefaultAsync(d => d.DeviceId == deviceId, ct)
                ?? throw new InvalidOperationException($"Device {deviceId} not found");

            var employees = await _db.Employees
                .Where(e => e.IsActive && e.ApprovalStatus != "Pending" && e.ApprovalStatus != "Rejected")
                .ToListAsync(ct);

            var allTemplates = await _db.FingerprintTemplates.ToListAsync(ct);
            var byEmployee = allTemplates.GroupBy(t => t.EmployeeId)
                                         .ToDictionary(g => g.Key, g => g.ToList());

            var warnings = new List<string>();
            var done = 0;

            foreach (var employee in employees)
            {
                var links = await LinksAsync(employee.EmployeeId, ct);
                var enrolNumber = EnrolNumberFor(links, deviceId, employee);
                byEmployee.TryGetValue(employee.EmployeeId, out var templates);

                var (_, ok) = await WriteEmployeeToDeviceAsync(
                    device, employee, enrolNumber, templates ?? new List<FingerprintTemplate>(), warnings, ct);
                if (ok) done++;
            }

            device.IsProvisioned = done > 0;
            device.ModifiedDate = DateTime.Now;
            await _db.SaveChangesAsync(ct);

            _logger.LogInformation(
                "Provisioned {Device}: {Done}/{Total} employee(s) written, {Warnings} warning(s)",
                device.DeviceName, done, employees.Count, warnings.Count);

            return done;
        }

        public async Task<int> ReconcileAllAsync(CancellationToken ct = default)
        {
            var devices = await ActiveDevicesAsync(ct);
            if (devices.Count < 2) return 0;

            // Everyone who has a cached template but is missing a confirmed
            // enrolment on at least one active terminal.
            var employeeIds = await _db.FingerprintTemplates
                .Select(t => t.EmployeeId)
                .Distinct()
                .ToListAsync(ct);

            var repaired = 0;

            foreach (var employeeId in employeeIds)
            {
                ct.ThrowIfCancellationRequested();

                var links = await _db.EmployeeDevices
                    .Where(ed => ed.EmployeeId == employeeId && ed.IsActive)
                    .ToListAsync(ct);

                var missing = devices
                    .Where(d => !links.Any(l => l.DeviceId == d.DeviceId && l.IsEnrolled))
                    .ToList();

                if (missing.Count == 0) continue;

                try
                {
                    await PullAndPropagateAsync(employeeId, ct);
                    repaired++;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Reconcile failed for employee {Id}", employeeId);
                }
            }

            if (repaired > 0)
                _logger.LogInformation("Reconciled {Count} employee(s) across {Devices} terminals", repaired, devices.Count);

            return repaired;
        }

        // ── shared helpers ──────────────────────────────────────────────

        private async Task<Employee> LoadEmployeeAsync(int employeeId, CancellationToken ct) =>
            await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.EmployeeId == employeeId, ct)
            ?? throw new InvalidOperationException($"Employee {employeeId} not found");

        private async Task<List<Device>> ActiveDevicesAsync(CancellationToken ct) =>
            await _db.Devices.Where(d => d.IsActive).OrderBy(d => d.DeviceId).ToListAsync(ct);

        private async Task<List<EmployeeDevice>> LinksAsync(int employeeId, CancellationToken ct) =>
            await _db.EmployeeDevices.Where(ed => ed.EmployeeId == employeeId).ToListAsync(ct);

        /// <summary>
        /// The number THIS device knows the person by. Devices allocate their
        /// own, so 1017 at head office may be 88 at the branch; the link table
        /// is the only place that mapping lives.
        /// </summary>
        private static string EnrolNumberFor(List<EmployeeDevice> links, int deviceId, Employee employee)
        {
            var link = links.FirstOrDefault(l => l.DeviceId == deviceId);
            return !string.IsNullOrWhiteSpace(link?.BiometricUserId)
                ? link!.BiometricUserId
                : employee.BiometricUserId;
        }

        private static Device? PickMaster(List<Device> devices) =>
            devices.FirstOrDefault(d => d.Role == DeviceRole.Master)
            ?? devices.FirstOrDefault();

        private async Task<Device> ResolveEnrolmentDeviceAsync(int? deviceId, CancellationToken ct)
        {
            if (deviceId is { } id)
                return await _db.Devices.FirstOrDefaultAsync(d => d.DeviceId == id, ct)
                    ?? throw new InvalidOperationException($"Device {id} not found");

            var devices = await ActiveDevicesAsync(ct);
            return PickMaster(devices)
                ?? throw new InvalidOperationException(
                    "No active device is registered, so there is nowhere to enrol. Add a device first.");
        }

        private static DeviceEnrollmentState Unreachable(Device d, string enrolNumber, string? message = null) =>
            new(d.DeviceId, d.DeviceName, d.Role.ToString(), d.IsActive,
                false, enrolNumber, false, 0, message ?? "Terminal is offline.");

        private async Task EnsureLinkAsync(
            int employeeId, int deviceId, string enrolNumber, bool enrolled, CancellationToken ct)
        {
            var link = await _db.EmployeeDevices
                .FirstOrDefaultAsync(ed => ed.EmployeeId == employeeId && ed.DeviceId == deviceId, ct);

            if (link is null)
            {
                _db.EmployeeDevices.Add(new EmployeeDevice
                {
                    EmployeeId = employeeId,
                    DeviceId = deviceId,
                    BiometricUserId = enrolNumber,
                    IsEnrolled = enrolled,
                    EnrolledDate = enrolled ? DateTime.Now : null,
                    IsActive = true,
                    CreatedDate = DateTime.Now
                });
                return;
            }

            link.BiometricUserId = enrolNumber;
            link.IsActive = true;
            link.ModifiedDate = DateTime.Now;
            if (enrolled && !link.IsEnrolled)
            {
                link.IsEnrolled = true;
                link.EnrolledDate = DateTime.Now;
            }
        }

        private async Task MarkEnrolledAsync(
            int employeeId, int deviceId, string enrolNumber, bool enrolled, CancellationToken ct)
        {
            await EnsureLinkAsync(employeeId, deviceId, enrolNumber, enrolled, ct);
        }

        /// <summary>Store or refresh the cached copy of each pulled template.</summary>
        private async Task<int> CacheTemplatesAsync(
            int employeeId, int sourceDeviceId, List<FingerTemplate> pulled, CancellationToken ct)
        {
            if (pulled.Count == 0) return 0;

            var existing = await _db.FingerprintTemplates
                .Where(t => t.EmployeeId == employeeId)
                .ToListAsync(ct);

            foreach (var t in pulled)
            {
                var row = existing.FirstOrDefault(x => x.FingerIndex == t.FingerIndex);
                if (row is null)
                {
                    _db.FingerprintTemplates.Add(new FingerprintTemplate
                    {
                        EmployeeId = employeeId,
                        FingerIndex = t.FingerIndex,
                        TemplateData = t.Data,
                        TemplateFormatVersion = t.FormatVersion,
                        SourceDeviceId = sourceDeviceId,
                        CapturedDate = DateTime.Now
                    });
                }
                else
                {
                    row.TemplateData = t.Data;
                    row.TemplateFormatVersion = t.FormatVersion;
                    row.SourceDeviceId = sourceDeviceId;
                    row.CapturedDate = DateTime.Now;
                }
            }

            await _db.SaveChangesAsync(ct);
            return pulled.Count;
        }
    }
}
