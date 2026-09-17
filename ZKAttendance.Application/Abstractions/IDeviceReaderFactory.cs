using ZKAttendance.Domain.Enums;

namespace ZKAttendance.Application.Abstractions
{
    /// <summary>
    /// Creates the correct <see cref="IZkDeviceReader"/> for a given device vendor type.
    ///
    /// WHY THIS EXISTS
    /// ---------------
    /// The original design used a global <c>Func&lt;IZkDeviceReader&gt;</c> registered in
    /// Program.cs from a single config key ("Tcp" or "Fake"). That means every device
    /// in every company gets the same reader — impossible to mix ZKTeco and Hikvision
    /// terminals in the same deployment.
    ///
    /// This factory is keyed by <see cref="DeviceType"/>, which is now a column on the
    /// Devices table. The sync service passes <c>device.DeviceType</c> and gets back
    /// the right reader. The rest of the pipeline (outbox, SyncLog, punch attribution)
    /// is completely unchanged.
    ///
    /// ADDING A NEW VENDOR
    /// -------------------
    /// 1. Add a value to <see cref="DeviceType"/>.
    /// 2. Create a class that implements <see cref="IZkDeviceReader"/>.
    /// 3. Register it with <c>AddTransient</c> in Program.cs.
    /// 4. Add a <c>case</c> in <see cref="DeviceReaderFactory"/> (Infrastructure layer).
    /// Nothing else changes.
    /// </summary>
    public interface IDeviceReaderFactory
    {
        /// <summary>Returns a fresh, unconnected reader for the given vendor type.</summary>
        IAttendanceDeviceReader Create(DeviceType deviceType);
    }
}
