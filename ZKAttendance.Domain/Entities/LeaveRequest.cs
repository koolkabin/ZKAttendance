using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ZKAttendance.Domain.Entities
{
    public enum LeaveRequestStatus
    {
        Draft = 0,
        Pending = 1,
        Approved = 2,
        Rejected = 3,
        Cancelled = 4
    }

    [Table("LeaveRequests")]
    public class LeaveRequest
    {
        [Key]
        [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
        public int LeaveRequestId { get; set; }

        [Required]
        public int EmployeeId { get; set; }

        [ForeignKey("EmployeeId")]
        public virtual Employee? Employee { get; set; }

        /// <summary>Annual, Casual, Sick, Maternity, Paternity, Bereavement, Other</summary>
        [Required]
        [StringLength(50)]
        public string LeaveType { get; set; } = "Other";

        [Required]
        [Column(TypeName = "date")]
        public DateTime StartDate { get; set; }

        [Required]
        [Column(TypeName = "date")]
        public DateTime EndDate { get; set; }

        [StringLength(20)]
        public string? NepaliStartDate { get; set; }

        [StringLength(20)]
        public string? NepaliEndDate { get; set; }

        [Column(TypeName = "decimal(4, 1)")]
        public decimal TotalDays { get; set; } = 1.0m;

        public bool IsHalfDay { get; set; } = false;

        /// <summary>FirstHalf or SecondHalf</summary>
        [StringLength(20)]
        public string? HalfDayPeriod { get; set; }

        [Required]
        [StringLength(500)]
        public string Reason { get; set; } = string.Empty;

        [Required]
        public LeaveRequestStatus Status { get; set; } = LeaveRequestStatus.Pending;

        public DateTime CreatedDate { get; set; } = DateTime.Now;

        public DateTime? SubmittedDate { get; set; }

        public DateTime? DecidedDate { get; set; }

        [StringLength(100)]
        public string? DecidedBy { get; set; }

        [StringLength(500)]
        public string? AdminRemarks { get; set; }
    }
}
