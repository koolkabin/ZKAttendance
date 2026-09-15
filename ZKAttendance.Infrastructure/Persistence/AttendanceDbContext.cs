using Microsoft.EntityFrameworkCore;
using ZKAttendance.Domain.Entities;

namespace ZKAttendance.Infrastructure.Persistence
{
    public class AttendanceDbContext : DbContext
    {
        public AttendanceDbContext(DbContextOptions<AttendanceDbContext> options)
            : base(options)
        {
        }

        // ═════════════════════════════════════════════════════════════════
        // DbSets, ordered by importance
        // ═════════════════════════════════════════════════════════════════

        // Core Tables
        public DbSet<Branch> Branches { get; set; }
        public DbSet<Device> Devices { get; set; }
        public DbSet<Department> Departments { get; set; }
        public DbSet<Employee> Employees { get; set; }
        public DbSet<WorkShift> WorkShifts { get; set; }
        public DbSet<Holiday> Holidays { get; set; }

        // Attendance Tables
        public DbSet<AttendanceLog> AttendanceLogs { get; set; }

        // System Tables
        public DbSet<SyncLog> SyncLogs { get; set; }
        public DbSet<DeviceStatus> DeviceStatuses { get; set; }
        public DbSet<DeviceError> DeviceErrors { get; set; }
        public DbSet<SystemSetting> SystemSettings { get; set; }
        public DbSet<AttendanceApproval> AttendanceApprovals { get; set; }
        public DbSet<EmployeeShiftAssignment> EmployeeShiftAssignments { get; set; }

        // ✅ NEW: Many-to-Many Relationship Table
        public DbSet<EmployeeBranch> EmployeeBranches { get; set; }
        public DbSet<EmployeeDevice> EmployeeDevices { get; set; }

        // NEW - master-device enrolment flow
        public DbSet<FingerprintTemplate> FingerprintTemplates { get; set; }
        public DbSet<PendingEnrollment> PendingEnrollments { get; set; }

        // API authentication
        public DbSet<ApiUser> ApiUsers { get; set; }
        public DbSet<RefreshToken> RefreshTokens { get; set; }

        public DbSet<Notification> Notifications { get; set; }

        // Agent registration
        public DbSet<LocalServer> LocalServers { get; set; }

        // Leave Management
        public DbSet<LeaveRequest> LeaveRequests { get; set; }


        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // ═════════════════════════════════════════════════════
            // Branches Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<Branch>(entity =>
            {
                entity.HasKey(e => e.BranchId);
                entity.Property(e => e.BranchId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");

                entity.HasIndex(e => e.BranchCode)
                      .IsUnique()
                      .HasDatabaseName("IX_Branch_Code");
            });

            // ═════════════════════════════════════════════════════
            // Devices Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<Device>(entity =>
            {
                entity.HasKey(e => e.DeviceId);
                entity.Property(e => e.DeviceId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");

                entity.HasOne(d => d.Branch)
                      .WithMany(b => b.Devices)
                      .HasForeignKey(d => d.BranchId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasIndex(e => new { e.DeviceIP, e.DevicePort })
                      .IsUnique()
                      .HasDatabaseName("IX_Device_IP_Port");
            });

            // ═════════════════════════════════════════════════════
            // Departments Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<Department>(entity =>
            {
                entity.HasKey(e => e.DepartmentId);
                entity.Property(e => e.DepartmentId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");

                // Self-referencing relationship
                entity.HasOne(d => d.ParentDepartment)
                      .WithMany(d => d.SubDepartments)
                      .HasForeignKey(d => d.ParentDepartmentId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasIndex(e => e.DepartmentName)
                      .IsUnique()
                      .HasDatabaseName("IX_Department_Name");
            });

            // ═════════════════════════════════════════════════════
            // WorkShifts Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<WorkShift>(entity =>
            {
                entity.HasKey(e => e.ShiftId);
                entity.Property(e => e.ShiftId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");

                entity.HasIndex(e => e.ShiftName)
                      .HasDatabaseName("IX_WorkShift_Name");
            });

            // ═════════════════════════════════════════════════════
            // Holidays Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<Holiday>(entity =>
            {
                entity.HasKey(e => e.HolidayId);
                entity.Property(e => e.HolidayId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");

                entity.HasIndex(e => new { e.HolidayName, e.HolidayDate })
                      .IsUnique()
                      .HasDatabaseName("IX_Holiday_NameDate");
            });

            // ═════════════════════════════════════════════════════
            // Employees Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<Employee>(entity =>
            {
                entity.HasKey(e => e.EmployeeId);
                entity.Property(e => e.EmployeeId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");

                entity.HasOne(e => e.Department)
                      .WithMany(d => d.Employees)
                      .HasForeignKey(e => e.DepartmentId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(e => e.DefaultShift)
                      .WithMany(s => s.Employees)
                      .HasForeignKey(e => e.DefaultShiftId)
                      .OnDelete(DeleteBehavior.Restrict);

                // Email must identify exactly one person.
                //
                // Attendance emails are personal: two employees sharing an
                // address means one of them receives the other's check-in
                // times, which is both a privacy leak and a support call.
                //
                // Filtered, because email is optional. Without the filter the
                // many NULL rows would collide with each other and only one
                // employee could ever have a blank address.
                //
                // SQL Server's default collation is case-insensitive, so
                // 'Ram@x.com' and 'ram@x.com' already count as the same. The
                // API trims on write, which handles the trailing-space case
                // the collation does not.
                entity.HasIndex(e => e.Email)
                      .IsUnique()
                      .HasFilter("[Email] IS NOT NULL")
                      .HasDatabaseName("UX_Employee_Email");

                // CHANGED: no longer unique.
                // The biometric ID is a fact about a person on a particular
                // device, not about the person globally. A unique index here
                // forced every device to give the same person the same number,
                // which is not how enrolment works in practice. The real
                // uniqueness rule now lives on EmployeeDevices as
                // (DeviceId, BiometricUserId). This column is kept as the
                // employee's primary/default ID so existing screens and
                // reports keep working.
                entity.HasIndex(e => e.BiometricUserId)
                      .HasDatabaseName("IX_Employee_BiometricUserId");
            });

            // ═════════════════════════════════════════════════════
            // AttendanceLogs Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<AttendanceLog>(entity =>
            {
                entity.HasKey(e => e.LogId);
                entity.Property(e => e.LogId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.IsSynced).HasDefaultValue(true);
                entity.Property(e => e.IsProcessed).HasDefaultValue(false);
                entity.Property(e => e.IsManual).HasDefaultValue(false);

                entity.HasOne(a => a.Device)
                      .WithMany(d => d.AttendanceLogs)
                      .HasForeignKey(a => a.DeviceId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(a => a.Branch)
                      .WithMany(b => b.AttendanceLogs)
                      .HasForeignKey(a => a.BranchId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(a => a.Employee)
                      .WithMany(e => e.AttendanceLogs)
                      .HasForeignKey(a => a.EmployeeId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasIndex(e => new { e.BiometricUserId, e.AttendanceTime, e.DeviceId })
                      .IsUnique()
                      .HasDatabaseName("IX_AttendanceLog_Unique");

                entity.HasIndex(e => e.IsSynced)
                      .HasDatabaseName("IX_AttendanceLog_IsSynced");

                entity.HasIndex(e => e.IsProcessed)
                      .HasDatabaseName("IX_AttendanceLog_IsProcessed");
            });

            // ═════════════════════════════════════════════════════
            // SyncLogs Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<SyncLog>(entity =>
            {
                entity.HasKey(e => e.SyncId);
                entity.Property(e => e.SyncId).ValueGeneratedOnAdd();
                entity.Property(e => e.StartTime).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.Status).HasDefaultValue("Pending");

                entity.HasOne(s => s.Device)
                      .WithMany()
                      .HasForeignKey(s => s.DeviceId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(s => s.Branch)
                      .WithMany()
                      .HasForeignKey(s => s.BranchId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasIndex(e => new { e.DeviceId, e.StartTime })
                      .HasDatabaseName("IX_SyncLog_Device_Time");

                entity.HasIndex(e => e.Status)
                      .HasDatabaseName("IX_SyncLog_Status");
            });

            // ═════════════════════════════════════════════════════
            // LocalServers Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<LocalServer>(entity =>
            {
                entity.HasKey(e => e.LocalServerId);
                entity.Property(e => e.LocalServerId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.IsActive).HasDefaultValue(true);

                // AgentKey must be unique so App1 can look up the agent in O(log n).
                entity.HasIndex(e => e.AgentKey)
                      .IsUnique()
                      .HasDatabaseName("UX_LocalServer_AgentKey");

                entity.HasOne(e => e.Branch)
                      .WithMany()
                      .HasForeignKey(e => e.BranchId)
                      .OnDelete(DeleteBehavior.Restrict);
            });


            // ═════════════════════════════════════════════════════
            // DeviceStatus Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<DeviceStatus>(entity =>
            {
                entity.HasKey(e => e.StatusId);
                entity.Property(e => e.StatusId).ValueGeneratedOnAdd();
                entity.Property(e => e.StatusTime).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.LastUpdateTime).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.IsOnline).HasDefaultValue(false);

                entity.HasOne(ds => ds.Device)
                      .WithMany(d => d.DeviceStatuses)
                      .HasForeignKey(ds => ds.DeviceId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(ds => ds.Branch)
                      .WithMany()
                      .HasForeignKey(ds => ds.BranchId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasIndex(e => new { e.DeviceId, e.StatusTime })
                      .HasDatabaseName("IX_DeviceStatus_Device_Time");

                entity.HasIndex(e => e.IsOnline)
                      .HasDatabaseName("IX_DeviceStatus_IsOnline");
            });

            // ═════════════════════════════════════════════════════
            // DeviceErrors Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<DeviceError>(entity =>
            {
                entity.HasKey(e => e.ErrorId);
                entity.Property(e => e.ErrorId).ValueGeneratedOnAdd();
                entity.Property(e => e.ErrorDateTime).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.Severity).HasDefaultValue("Medium");
                entity.Property(e => e.IsResolved).HasDefaultValue(false);

                entity.HasOne(de => de.Device)
                      .WithMany()
                      .HasForeignKey(de => de.DeviceId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(de => de.Branch)
                      .WithMany()
                      .HasForeignKey(de => de.BranchId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasIndex(e => new { e.DeviceId, e.ErrorDateTime })
                      .HasDatabaseName("IX_DeviceError_Device_Time");

                entity.HasIndex(e => e.IsResolved)
                      .HasDatabaseName("IX_DeviceError_IsResolved");
            });

            // ═════════════════════════════════════════════════════
            // AttendanceApprovals Configuration
            modelBuilder.Entity<AttendanceApproval>(entity =>
            {
                entity.HasKey(e => e.ApprovalId);

                entity.HasOne(e => e.Employee)
                      .WithMany()
                      .HasForeignKey(e => e.EmployeeId)
                      .OnDelete(DeleteBehavior.Cascade);

                // One decision per employee per day.
                entity.HasIndex(e => new { e.EmployeeId, e.AttendanceDate })
                      .IsUnique()
                      .HasDatabaseName("IX_AttendanceApproval_Employee_Date");

                // The approval queue is read by status and date every time the
                // page opens, so it gets its own index.
                entity.HasIndex(e => new { e.Status, e.AttendanceDate })
                      .HasDatabaseName("IX_AttendanceApproval_Status_Date");

                entity.Property(e => e.Status).HasConversion<int>();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");
            });

            // SystemSettings Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<SystemSetting>(entity =>
            {
                entity.HasKey(e => e.SettingId);
                entity.Property(e => e.SettingId).ValueGeneratedOnAdd();
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");

                entity.HasIndex(e => e.SettingKey)
                      .IsUnique()
                      .HasDatabaseName("IX_SystemSetting_Key");
            });

            // ═════════════════════════════════════════════════════
            // EmployeeShiftAssignments Configuration
            // ═════════════════════════════════════════════════════
            modelBuilder.Entity<EmployeeShiftAssignment>(entity =>
            {
                entity.HasKey(e => e.AssignmentId);
                entity.Property(e => e.AssignmentId).ValueGeneratedOnAdd();
                entity.Property(e => e.EffectiveFrom).HasDefaultValueSql("GETDATE()");
                entity.Property(e => e.IsActive).HasDefaultValue(true);

                entity.HasOne(e => e.Employee)
                      .WithMany()
                      .HasForeignKey(e => e.EmployeeId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(e => e.Shift)
                      .WithMany()
                      .HasForeignKey(e => e.ShiftId)
                      .OnDelete(DeleteBehavior.Restrict);

                entity.HasIndex(e => new { e.EmployeeId, e.EffectiveFrom })
                      .HasDatabaseName("IX_EmployeeShift_Effective");
            });

            // ═════════════════════════════════════════════════════════════════
            // ✅ NEW: EmployeeBranches Configuration (Many-to-Many)
            // ═════════════════════════════════════════════════════════════════
            modelBuilder.Entity<EmployeeBranch>(entity =>
            {
                // Primary Key
                entity.HasKey(e => e.EmployeeBranchId);
                entity.Property(e => e.EmployeeBranchId)
                    .ValueGeneratedOnAdd();

                // Relationship: Employee → EmployeeBranches
                entity.HasOne(eb => eb.Employee)
                    .WithMany(e => e.EmployeeBranches)
                    .HasForeignKey(eb => eb.EmployeeId)
                    .OnDelete(DeleteBehavior.Cascade); // Deleting an employee removes their links

                // Relationship: Branch → EmployeeBranches
                entity.HasOne(eb => eb.Branch)
                    .WithMany(b => b.EmployeeBranches)
                    .HasForeignKey(eb => eb.BranchId)
                    .OnDelete(DeleteBehavior.Restrict); // Block deleting a branch that still has employees

                // Unique index: an employee appears once per branch
                entity.HasIndex(e => new { e.EmployeeId, e.BranchId })
                    .IsUnique()
                    .HasDatabaseName("IX_EmployeeBranch_Unique");

                // Default Values
                entity.Property(e => e.AssignedDate)
                    .HasDefaultValueSql("GETDATE()");

                entity.Property(e => e.IsActive)
                    .HasDefaultValue(true);
            });

            // ═════════════════════════════════════════════════════════════════
            // ✅ NEW: EmployeeDevice Configuration (Many-to-Many)
            // ═════════════════════════════════════════════════════════════════
            modelBuilder.Entity<EmployeeDevice>(entity =>
            {
                entity.HasKey(e => e.EmployeeDeviceId);

            entity.HasOne(e => e.Employee)
                .WithMany(emp => emp.EmployeeDevices)
                .HasForeignKey(e => e.EmployeeId)
                .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(e => e.Device)
                    .WithMany(d => d.EmployeeDevices)
                    .HasForeignKey(e => e.DeviceId)
                    .OnDelete(DeleteBehavior.Cascade);

                // An employee appears at most once per device.
                entity.HasIndex(e => new { e.EmployeeId, e.DeviceId })
                    .IsUnique()
                    .HasDatabaseName("IX_EmployeeDevice_Employee_Device");

                // THE IMPORTANT ONE.
                // On a single device a biometric ID belongs to exactly one
                // employee. Across devices the same number may be reused by
                // different people, which is why the index is on
                // (DeviceId, BiometricUserId) and not on BiometricUserId alone.
                entity.HasIndex(e => new { e.DeviceId, e.BiometricUserId })
                    .IsUnique()
                    .HasDatabaseName("IX_EmployeeDevice_Device_BiometricId");

                entity.Property(e => e.IsActive).HasDefaultValue(true);
                entity.Property(e => e.IsEnrolled).HasDefaultValue(false);
                entity.Property(e => e.CreatedDate).HasDefaultValueSql("GETDATE()");
            });

            // ═════════════════════════════════════════════════════════════
            // Master device: only ONE, enforced by the database
            // ═════════════════════════════════════════════════════════════
            modelBuilder.Entity<Device>(entity =>
            {
                entity.Property(e => e.Role).HasConversion<int>();

                // A filtered unique index over a constant column: every active
                // master row writes the same value, so the second one is
                // rejected. Doing this check in C# leaves a race between two
                // administrators, and two masters means enrolments pulled from
                // both machines with colliding enrol numbers.
                entity.HasIndex(e => e.Role)
                      .IsUnique()
                      .HasFilter("[Role] = 1 AND [IsActive] = 1")
                      .HasDatabaseName("UX_Device_SingleMaster");
            });

            // ═════════════════════════════════════════════════════════════
            // FingerprintTemplate - cached so a new device can be provisioned
            // without recalling every employee to press their finger again
            // ═════════════════════════════════════════════════════════════
            modelBuilder.Entity<FingerprintTemplate>(entity =>
            {
                entity.HasKey(e => e.TemplateId);

                // Opaque blob produced by the sensor's own algorithm. The
                // application never interprets it, only stores and replays it.
                entity.Property(e => e.TemplateData)
                      .HasColumnType("varbinary(max)")
                      .IsRequired();

                entity.HasOne(e => e.Employee)
                      .WithMany(emp => emp.Templates)
                      .HasForeignKey(e => e.EmployeeId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasIndex(e => new { e.EmployeeId, e.FingerIndex })
                      .IsUnique()
                      .HasDatabaseName("UX_Template_Employee_Finger");
            });

            // ═════════════════════════════════════════════════════════════
            // PendingEnrollment - discovered on the master, awaiting HR review
            // ═════════════════════════════════════════════════════════════
            modelBuilder.Entity<PendingEnrollment>(entity =>
            {
                entity.HasKey(e => e.PendingEnrollmentId);
                entity.Property(e => e.DeviceUserId).HasMaxLength(12).IsRequired();
                entity.Property(e => e.NameOnDevice).HasMaxLength(100);
                entity.Property(e => e.ReviewedBy).HasMaxLength(100);
                entity.Property(e => e.RejectionReason).HasMaxLength(400);
                entity.Property(e => e.Status).HasConversion<int>();

                entity.HasOne(e => e.Device)
                      .WithMany()
                      .HasForeignKey(e => e.DeviceId)
                      .OnDelete(DeleteBehavior.Cascade);

                // One row per number per device whatever the status. Rejected
                // rows stay so a technician's test enrolment is not
                // rediscovered and re-raised on every pull.
                entity.HasIndex(e => new { e.DeviceId, e.DeviceUserId })
                      .IsUnique()
                      .HasDatabaseName("UX_Pending_Device_UserId");
            });

            // ═════════════════════════════════════════════════════════════
            // API accounts and refresh tokens
            // ═════════════════════════════════════════════════════════════
            modelBuilder.Entity<ApiUser>(entity =>
            {
                entity.HasKey(e => e.ApiUserId);
                entity.HasIndex(e => e.Username).IsUnique().HasDatabaseName("UX_ApiUser_Username");
                entity.HasIndex(e => e.Email).IsUnique().HasDatabaseName("UX_ApiUser_Email");

                // One login per employee. Filtered so the bootstrap 'admin'
                // account (EmployeeId = null) is not caught by the constraint.
                entity.HasIndex(e => e.EmployeeId)
                      .IsUnique()
                      .HasFilter("[EmployeeId] IS NOT NULL")
                      .HasDatabaseName("UX_ApiUser_Employee");
            });

            modelBuilder.Entity<RefreshToken>(entity =>
            {
                entity.HasKey(e => e.RefreshTokenId);

                entity.HasOne(e => e.User)
                      .WithMany(u => u.RefreshTokens)
                      .HasForeignKey(e => e.ApiUserId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasIndex(e => e.Token).IsUnique().HasDatabaseName("UX_RefreshToken_Token");
            });

            // ═════════════════════════════════════════════════════════════
            // LocalServer - registered remote agents (App2)
            // ═════════════════════════════════════════════════════════════
            modelBuilder.Entity<LocalServer>(entity =>
            {
                entity.HasKey(e => e.LocalServerId);
                entity.HasIndex(e => e.AgentKey).IsUnique().HasDatabaseName("UX_LocalServer_AgentKey");

                entity.HasOne(e => e.Branch)
                      .WithMany()
                      .HasForeignKey(e => e.BranchId)
                      .OnDelete(DeleteBehavior.Restrict);
            });

            // ═════════════════════════════════════════════════════════════
            // LeaveRequest - Employee leave requests & approvals
            // ═════════════════════════════════════════════════════════════
            modelBuilder.Entity<LeaveRequest>(entity =>
            {
                entity.HasKey(e => e.LeaveRequestId);

                entity.HasOne(e => e.Employee)
                      .WithMany()
                      .HasForeignKey(e => e.EmployeeId)
                      .OnDelete(DeleteBehavior.Cascade);

                entity.HasIndex(e => new { e.EmployeeId, e.StartDate, e.EndDate })
                      .HasDatabaseName("IX_LeaveRequest_Employee_Dates");

                entity.HasIndex(e => e.Status)
                      .HasDatabaseName("IX_LeaveRequest_Status");
            });
        }
    }
}
