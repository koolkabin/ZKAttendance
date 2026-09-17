using ZKAttendance.Application.Abstractions;
using ZKAttendance.Domain.Enums;

namespace ZKAttendance.Infrastructure.Devices
{
    /// <summary>
    /// Concrete implementation of <see cref="IDeviceReaderFactory"/>.
    ///
    /// Each vendor maps to a concrete <see cref="IAttendanceDeviceReader"/>. The readers
    /// are registered as transient services so a new instance is created every
    /// time <see cref="Create"/> is called.
    /// </summary>
    public sealed class DeviceReaderFactory : IDeviceReaderFactory
    {
        private readonly IServiceProvider _sp;

        public DeviceReaderFactory(IServiceProvider sp) => _sp = sp;

        public IAttendanceDeviceReader Create(DeviceType deviceType) => deviceType switch
        {
            DeviceType.ZkTeco    => _sp.GetRequiredService<ZkTcpDeviceReader>(),
            DeviceType.Hikvision => _sp.GetRequiredService<HikvisionDeviceReader>(),
            DeviceType.Dahua     => _sp.GetRequiredService<DahuaDeviceReader>(),
            DeviceType.Anviz     => _sp.GetRequiredService<AnvizDeviceReader>(),
            DeviceType.eSSL      => _sp.GetRequiredService<eSSLDeviceReader>(),
            DeviceType.HttpPush  => _sp.GetRequiredService<HttpPushDeviceReader>(),
            DeviceType.Fake      => _sp.GetRequiredService<FakeDeviceReader>(),
            _ => throw new NotSupportedException(
                $"DeviceType '{deviceType}' has no registered reader. " +
                "Add an IAttendanceDeviceReader implementation and a case in DeviceReaderFactory.")
        };
    }
}
