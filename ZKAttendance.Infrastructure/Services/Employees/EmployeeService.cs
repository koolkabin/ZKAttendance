using Microsoft.EntityFrameworkCore;
using ZKAttendance.Infrastructure.Persistence;
using ZKAttendance.Infrastructure.Persistence.Repositories;
using ZKAttendance.Domain.Entities;

using ZKAttendance.Application.Abstractions;

namespace ZKAttendance.Infrastructure.Services.Employees
{
	public class EmployeeService : IEmployeeService
	{
		private readonly EmployeeRepository _repository;
		private readonly ILogger<EmployeeService> _logger;
		private readonly AttendanceDbContext _context;

		public EmployeeService(
			EmployeeRepository repository,
			ILogger<EmployeeService> logger,
			AttendanceDbContext context)
		{
			_repository = repository;
			_logger = logger;
			_context = context;
		}

		public async Task<List<Employee>> GetAllEmployeesAsync()
		{
			try
			{
				return await _repository.GetAllAsync();
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error fetching the employee list");
				throw;
			}
		}

		public async Task<Employee?> GetEmployeeByIdAsync(int employeeId)
		{
			try
			{
				return await _repository.GetByIdAsync(employeeId);
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error fetching the employee {EmployeeId}", employeeId);
				throw;
			}
		}

		public async Task<Employee?> GetEmployeeByBiometricIdAsync(string biometricUserId)
		{
			try
			{
				return await _repository.GetByBiometricIdAsync(biometricUserId);
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error fetching employee by biometric ID: {BiometricId}", biometricUserId);
				throw;
			}
		}

		public async Task<List<Employee>> GetEmployeesByDepartmentIdAsync(int departmentId)
		{
			try
			{
				return await _repository.GetByDepartmentIdAsync(departmentId);
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error fetching department employees {DepartmentId}", departmentId);
				throw;
			}
		}

		// Next biometric ID = highest existing + 1, across employees and logs
		public async Task<string> GetNextBiometricUserIdAsync()
		{
			try
			{
				// 1. Highest number in Employees
				var employees = await _repository.GetAllAsync();
				var maxEmployeeId = employees
					.Select(e => e.BiometricUserId)
					.Where(id => int.TryParse(id, out _))
					.Select(id => int.Parse(id))
					.DefaultIfEmpty(0)
					.Max();

				// 2. Highest number in AttendanceLogs
				var attendanceLogs = await _context.AttendanceLogs
					.Select(a => a.BiometricUserId)
					.Distinct()
					.ToListAsync(); // materialise first

				var maxAttendanceLogId = attendanceLogs
					.Where(id => int.TryParse(id, out _)) // filter in memory
					.Select(id => int.Parse(id))
					.DefaultIfEmpty(0)
					.Max();

				// 3. Take whichever is larger
				var maxId = Math.Max(maxEmployeeId, maxAttendanceLogId);

				return (maxId + 1).ToString();
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error getting the next biometric ID");
				return "1"; // fall back to 1 on error
			}
		}


		// Get biometric IDs that have no employee
		public async Task<List<string>> GetUnregisteredBiometricIdsAsync()
		{
			try
			{
				// Biometric IDs from Employees
				var employeeBiometricIds = await _repository.GetAllAsync()
					.ContinueWith(task => task.Result
						.Select(e => e.BiometricUserId)
						.ToList());

				// Biometric IDs from AttendanceLogs
				var attendanceBiometricIds = await _context.AttendanceLogs
					.Select(a => a.BiometricUserId)
					.Distinct()
					.ToListAsync();

				// IDs present in AttendanceLogs but missing from Employees
				var unregistered = attendanceBiometricIds
					.Except(employeeBiometricIds)
					.OrderBy(id => int.TryParse(id, out int num) ? num : int.MaxValue)
					.ToList();

				return unregistered;
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error getting unregistered biometric IDs");
				return new List<string>();
			}
		}

		public async Task<Employee> CreateEmployeeAsync(Employee employee)
		{
			try
			{
				if (string.IsNullOrWhiteSpace(employee.EmployeeName))
				{
					throw new InvalidOperationException("Employee name is required.");
				}

				if (!employee.DepartmentId.HasValue || employee.DepartmentId.Value <= 0)
				{
					throw new InvalidOperationException("Department is required.");
				}

				// Reject a duplicate BiometricUserId
				if (await _repository.BiometricIdExistsAsync(employee.BiometricUserId))
				{
					throw new InvalidOperationException(
						$"Employee No. '{employee.BiometricUserId}' already exists");
				}

				employee.IsActive = true;
				employee.CreatedDate = DateTime.Now;

				var result = await _repository.AddAsync(employee);
				_logger.LogInformation("Created employee: {EmployeeName}", employee.EmployeeName);

				if (!string.IsNullOrWhiteSpace(result.BiometricUserId))
				{
					var unmapped = await _context.AttendanceLogs
						.Where(a => a.BiometricUserId == result.BiometricUserId && a.EmployeeId == null)
						.ToListAsync();
					foreach (var p in unmapped)
						p.EmployeeId = result.EmployeeId;
					if (unmapped.Count > 0)
						await _context.SaveChangesAsync();
				}

				return result;
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error creating employee: {EmployeeName}", employee.EmployeeName);
				throw;
			}
		}

		public async Task<Employee> UpdateEmployeeAsync(Employee employee)
		{
			try
			{
				if (!await _repository.ExistsAsync(employee.EmployeeId))
				{
					throw new InvalidOperationException("Employee not found");
				}

				if (string.IsNullOrWhiteSpace(employee.EmployeeName))
				{
					throw new InvalidOperationException("Employee name is required.");
				}

				if (!employee.DepartmentId.HasValue || employee.DepartmentId.Value <= 0)
				{
					throw new InvalidOperationException("Department is required.");
				}

				// Capture the previous BiometricUserId before saving
				string? oldBiometricUserId = null;
				var entry = _context.Entry(employee);
				if (entry.State != EntityState.Detached)
				{
					oldBiometricUserId = entry.Property(e => e.BiometricUserId).OriginalValue;
				}
				if (string.IsNullOrEmpty(oldBiometricUserId))
				{
					oldBiometricUserId = await _context.Employees
						.AsNoTracking()
						.Where(e => e.EmployeeId == employee.EmployeeId)
						.Select(e => e.BiometricUserId)
						.FirstOrDefaultAsync();
				}

				employee.ModifiedDate = DateTime.Now;
				var result = await _repository.UpdateAsync(employee);

				_logger.LogInformation("Updated employee: {EmployeeName}", employee.EmployeeName);

				// If BiometricUserId changed, update device mappings and attendance logs
				if (!string.IsNullOrWhiteSpace(oldBiometricUserId) && oldBiometricUserId != result.BiometricUserId)
				{
					// 1. Update EmployeeDevices so device sync doesn't keep attributing old ID to this employee
					var existingDeviceLinks = await _context.EmployeeDevices
						.Where(ed => ed.EmployeeId == employee.EmployeeId && ed.BiometricUserId == oldBiometricUserId)
						.ToListAsync();

					foreach (var ed in existingDeviceLinks)
					{
						if (!string.IsNullOrWhiteSpace(result.BiometricUserId))
						{
							var clash = await _context.EmployeeDevices
								.AnyAsync(x => x.DeviceId == ed.DeviceId && x.BiometricUserId == result.BiometricUserId && x.EmployeeId != employee.EmployeeId);
							if (!clash)
							{
								ed.BiometricUserId = result.BiometricUserId;
							}
							else
							{
								_context.EmployeeDevices.Remove(ed);
							}
						}
						else
						{
							_context.EmployeeDevices.Remove(ed);
						}
					}

					// 2. Unlink punches for oldBiometricUserId that were previously linked to this employee
					var oldLogs = await _context.AttendanceLogs
						.Where(a => a.BiometricUserId == oldBiometricUserId && a.EmployeeId == employee.EmployeeId)
						.ToListAsync();

					// Check if another employee currently holds oldBiometricUserId
					var rightfulOwner = await _context.Employees
						.FirstOrDefaultAsync(e => e.BiometricUserId == oldBiometricUserId && e.EmployeeId != employee.EmployeeId);

					foreach (var log in oldLogs)
					{
						log.EmployeeId = rightfulOwner?.EmployeeId;
					}

					// 3. Link punches for new BiometricUserId to this employee
					if (!string.IsNullOrWhiteSpace(result.BiometricUserId))
					{
						var newLogs = await _context.AttendanceLogs
							.Where(a => a.BiometricUserId == result.BiometricUserId)
							.ToListAsync();
						foreach (var log in newLogs)
						{
							log.EmployeeId = employee.EmployeeId;
						}
					}

					await _context.SaveChangesAsync();
				}
				else if (!string.IsNullOrWhiteSpace(result.BiometricUserId))
				{
					var unmapped = await _context.AttendanceLogs
						.Where(a => a.BiometricUserId == result.BiometricUserId && a.EmployeeId == null)
						.ToListAsync();
					foreach (var p in unmapped)
						p.EmployeeId = result.EmployeeId;
					if (unmapped.Count > 0)
						await _context.SaveChangesAsync();
				}

				return result;
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error updating employee {EmployeeId}", employee.EmployeeId);
				throw;
			}
		}

		public async Task DeleteEmployeeAsync(int employeeId)
		{
			try
			{
				await _repository.SoftDeleteAsync(employeeId);
				_logger.LogInformation("Employee deleted {EmployeeId}", employeeId);
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error deleting employee {EmployeeId}", employeeId);
				throw;
			}
		}

		public async Task<bool> IsBiometricIdExistsAsync(string biometricUserId, int? excludeEmployeeId = null)
		{
			try
			{
				return await _repository.BiometricIdExistsAsync(biometricUserId, excludeEmployeeId);
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error checking biometric ID: {BiometricId}", biometricUserId);
				throw;
			}
		}

		public async Task<Dictionary<string, Employee>> GetEmployeesDictionaryAsync(List<string> biometricUserIds)
		{
			try
			{
				return await _repository.GetEmployeesDictionaryAsync(biometricUserIds);
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error building the employee lookup");
				throw;
			}
		}

		public async Task<int> GetActiveEmployeeCountAsync()
		{
			try
			{
				return await _repository.GetActiveEmployeeCountAsync();
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error counting active employees");
				throw;
			}
		}
		// Get the most recent X biometric IDs
		public async Task<List<string>> GetLastBiometricUserIdsAsync(int count = 10)
		{
			try
			{
				// Collect IDs from employees and attendance logs
				var employeeIds = await _repository.GetAllAsync()
					.ContinueWith(task => task.Result
						.Select(e => e.BiometricUserId)
						.Where(id => int.TryParse(id, out _))
						.Select(id => int.Parse(id))
						.ToList());

				var attendanceIds = await _context.AttendanceLogs
					.Select(a => a.BiometricUserId)
					.Distinct()
					.ToListAsync();

				var attendanceIdsInt = attendanceIds
					.Where(id => int.TryParse(id, out _))
					.Select(id => int.Parse(id))
					.ToList();

				// Merge, de-duplicate and sort descending
				var allIds = employeeIds
					.Union(attendanceIdsInt)
					.OrderByDescending(id => id)
					.Take(count)
					.Select(id => id.ToString())
					.ToList();

				return allIds;
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error getting the most recent biometric IDs");
				return new List<string>();
			}
		}

		public async Task<int> ReconcileAttendanceLogMappingsAsync(CancellationToken ct = default)
		{
			try
			{
				// Map direct employee BiometricUserId -> EmployeeId
				var employees = await _context.Employees
					.Where(e => !string.IsNullOrEmpty(e.BiometricUserId))
					.ToDictionaryAsync(e => e.BiometricUserId, e => e.EmployeeId, ct);

				// Map per-device (BiometricUserId, DeviceId) -> EmployeeId
				var deviceMappings = await _context.EmployeeDevices
					.Where(ed => ed.IsActive)
					.ToDictionaryAsync(ed => (ed.BiometricUserId, ed.DeviceId), ed => ed.EmployeeId, ct);

				var logs = await _context.AttendanceLogs.ToListAsync(ct);
				int repaired = 0;

				foreach (var log in logs)
				{
					int? expectedEmployeeId = null;
					if (deviceMappings.TryGetValue((log.BiometricUserId, log.DeviceId), out var devEmpId))
					{
						expectedEmployeeId = devEmpId;
					}
					else if (employees.TryGetValue(log.BiometricUserId, out var dirEmpId))
					{
						expectedEmployeeId = dirEmpId;
					}

					if (log.EmployeeId != expectedEmployeeId)
					{
						log.EmployeeId = expectedEmployeeId;
						repaired++;
					}
				}

				if (repaired > 0)
				{
					await _context.SaveChangesAsync(ct);
					_logger.LogInformation("Reconciled {Count} attendance log mapping(s)", repaired);
				}

				return repaired;
			}
			catch (Exception ex)
			{
				_logger.LogError(ex, "Error reconciling attendance log mappings");
				throw;
			}
		}
	}
}
