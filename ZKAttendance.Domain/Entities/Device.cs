using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ZKAttendance.Domain.Enums;

namespace ZKAttendance.Domain.Entities
{
    [Table("Devices")]
    public class Device
    {
        [Key]
        [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
        public int DeviceId { get; set; }

        [Required]
        public int BranchId { get; set; }

        [Required]
        [MaxLength(200)]
        public string DeviceName { get; set; } = string.Empty;

        [Required]
        [MaxLength(50)]
        public string DeviceIP { get; set; } = string.Empty;

        [Required]
        public int DevicePort { get; set; } = 4370;

        [MaxLength(100)]
        public string? SerialNumber { get; set; }

        [MaxLength(100)]
        public string? DeviceModel { get; set; }

        /// <summary>
        /// The vendor / communication protocol this terminal uses.
        /// Determines which IZkDeviceReader implementation is instantiated when
        /// syncing or enrolling. Defaults to ZkTeco so existing rows are unaffected.
        /// </summary>
        public DeviceType DeviceType { get; set; } = DeviceType.ZkTeco;

        /// <summary>
        /// The device Communication Password (Comm Key) set on the terminal
        /// itself. 0 = none (factory default). The reader sends it during the
        /// connection handshake.
        /// </summary>
        public int CommPassword { get; set; } = 0;

        public bool IsActive { get; set; } = true;

        /// <summary>
        /// Master or slave. Exactly one ACTIVE device may be Master - enforced
        /// by a filtered unique index in the DbContext, not by hoping the UI
        /// gets it right.
        ///
        /// The master is the only machine anyone is enrolled on. Slaves receive
        /// their users by being written to from the application.
        /// </summary>
        public DeviceRole Role { get; set; } = DeviceRole.Slave;

        /// <summary>
        /// False until every active employee's template has been pushed here.
        /// A newly registered device starts unprovisioned and is filled from
        /// the templates already cached in the database.
        /// </summary>
        public bool IsProvisioned { get; set; }

        /// <summary>Last time enrolled users were pulled off this device.</summary>
        public DateTime? LastEnrollmentPullDate { get; set; }

        [NotMapped]
        public bool IsMaster => Role == DeviceRole.Master;

        public bool IsOnline { get; set; } = false;

        public DateTime? LastCheckTime { get; set; }

        public DateTime? LastConnectionTime { get; set; }

        [MaxLength(50)]
        public string? ConnectionStatus { get; set; }

        [Required]
        public DateTime CreatedDate { get; set; } = DateTime.Now;

        public DateTime? ModifiedDate { get; set; }

        // Navigation Properties
        [ForeignKey("BranchId")]
        public virtual Branch? Branch { get; set; }

        public virtual ICollection<DeviceStatus> DeviceStatuses { get; set; } = new List<DeviceStatus>();

        public virtual ICollection<AttendanceLog> AttendanceLogs { get; set; } = new List<AttendanceLog>();

        public virtual ICollection<EmployeeDevice> EmployeeDevices { get; set; } = new List<EmployeeDevice>();
    }
}
