using ZKAttendance.Domain.Entities;

namespace ZKAttendance.Application.Abstractions
{
    public interface IEmployeeService
    {
        Task<List<Employee>> GetAllEmployeesAsync();
        Task<Employee?> GetEmployeeByIdAsync(int employeeId);
        Task<Employee?> GetEmployeeByBiometricIdAsync(string biometricUserId);
        Task<List<Employee>> GetEmployeesByDepartmentIdAsync(int departmentId);
        Task<Employee> CreateEmployeeAsync(Employee employee);
        Task<Employee> UpdateEmployeeAsync(Employee employee);
        Task DeleteEmployeeAsync(int employeeId);
        Task<bool> IsBiometricIdExistsAsync(string biometricUserId, int? excludeEmployeeId = null);
        Task<Dictionary<string, Employee>> GetEmployeesDictionaryAsync(List<string> biometricUserIds);
        Task<int> GetActiveEmployeeCountAsync();
        Task<string> GetNextBiometricUserIdAsync();
        Task<List<string>> GetUnregisteredBiometricIdsAsync();
        Task<List<string>> GetLastBiometricUserIdsAsync(int count = 10);
        Task<int> ReconcileAttendanceLogMappingsAsync(CancellationToken ct = default);
    }
}
