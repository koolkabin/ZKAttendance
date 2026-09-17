using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ZKAttendance.Api.Security;
using ZKAttendance.Application.Dtos.Api;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Api.Controllers
{
    /// <summary>
    /// Holidays. A day marked here is excluded from the working-day count in
    /// the attendance overview and its cells show "Holiday" instead of "Absent".
    /// The weekly off (Saturday) is handled separately by the Nepali calendar
    /// and is not stored here.
    /// </summary>
    [Route("api/Holidays")]
    [ApiController]
    [Produces("application/json")]
    [Tags("Holidays")]
    [Authorize(Roles = Roles.Management)]
    public class HolidaysApiController : ControllerBase
    {
        private readonly AttendanceDbContext _db;
        private readonly ILogger<HolidaysApiController> _logger;

        public HolidaysApiController(AttendanceDbContext db, ILogger<HolidaysApiController> logger)
        {
            _db = db;
            _logger = logger;
        }

        /// <summary>Holidays, optionally within a date range.</summary>
        [HttpGet]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Get([FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            var q = _db.Holidays.AsNoTracking().Where(h => h.IsActive);
            if (from is { } f) q = q.Where(h => h.HolidayDate >= f.Date);
            if (to is { } t) q = q.Where(h => h.HolidayDate <= t.Date);

            var rows = await q.OrderBy(h => h.HolidayDate)
                .Select(h => new { h.HolidayId, h.HolidayName, date = h.HolidayDate, h.HolidayType, h.Description })
                .ToListAsync();
            return Ok(rows);
        }

        /// <summary>
        /// Mark a day or date range as holiday(s) (e.g. for multi-day festivals like Dashain or Tihar).
        /// If a holiday already exists on a date in the range, its details are updated.
        /// </summary>
        [HttpPost]
        [ProducesResponseType(200)]
        [ProducesResponseType(201)]
        [ProducesResponseType(typeof(ApiError), 400)]
        public async Task<IActionResult> Create([FromBody] HolidayRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.HolidayName))
                return BadRequest(ApiError.From("A name is required."));

            var startDate = (request.FromDate ?? request.Date).Date;
            var endDate = (request.ToDate ?? startDate).Date;

            if (endDate < startDate)
                return BadRequest(ApiError.From("To Date cannot be earlier than From Date."));

            var totalDays = (int)(endDate - startDate).TotalDays + 1;
            if (totalDays > 60)
                return BadRequest(ApiError.From("Holiday range cannot exceed 60 days."));

            var type = string.IsNullOrWhiteSpace(request.HolidayType) ? "Public" : request.HolidayType!.Trim();
            var note = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description!.Trim();

            var existingInRange = await _db.Holidays
                .Where(h => h.IsActive && h.HolidayDate >= startDate && h.HolidayDate <= endDate)
                .ToDictionaryAsync(h => h.HolidayDate.Date);

            var resultList = new List<object>();

            for (var cur = startDate; cur <= endDate; cur = cur.AddDays(1))
            {
                if (existingInRange.TryGetValue(cur, out var existing))
                {
                    existing.HolidayName = request.HolidayName.Trim();
                    existing.HolidayType = type;
                    existing.Description = note;
                    existing.DurationDays = totalDays;
                    existing.ModifiedDate = DateTime.Now;
                    resultList.Add(new { existing.HolidayId, existing.HolidayName, date = existing.HolidayDate, existing.HolidayType, existing.Description });
                }
                else
                {
                    var holiday = new Holiday
                    {
                        HolidayName = request.HolidayName.Trim(),
                        HolidayDate = cur,
                        Description = note,
                        HolidayType = type,
                        DurationDays = totalDays,
                        IsActive = true,
                        CreatedDate = DateTime.Now
                    };
                    _db.Holidays.Add(holiday);
                    resultList.Add(new { holiday.HolidayId, holiday.HolidayName, date = holiday.HolidayDate, holiday.HolidayType, holiday.Description });
                }
            }

            await _db.SaveChangesAsync();

            _logger.LogInformation(
                "Holiday '{Name}' ({Type}) added/updated for range {Start:yyyy-MM-dd} to {End:yyyy-MM-dd} ({Count} days) by {User}",
                request.HolidayName.Trim(), type, startDate, endDate, totalDays, User.Identity?.Name);

            return StatusCode(201, resultList.Count == 1 ? resultList[0] : new { count = totalDays, holidays = resultList });
        }

        /// <summary>Remove a holiday (unmark the day).</summary>
        [HttpDelete("{id:int}")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Delete(int id)
        {
            var row = await _db.Holidays.FirstOrDefaultAsync(h => h.HolidayId == id);
            if (row is null) return NotFound();
            _db.Holidays.Remove(row);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        /// <summary>Remove whatever holiday sits on a given date. Convenience for the calendar toggle.</summary>
        [HttpDelete("on/{date}")]
        [ProducesResponseType(200)]
        public async Task<IActionResult> DeleteOnDate(DateTime date)
        {
            var d = date.Date;
            var deleted = await _db.Holidays.Where(h => h.HolidayDate == d).ExecuteDeleteAsync();
            return Ok(new { date = d.ToString("yyyy-MM-dd"), deleted });
        }
    }

    public class HolidayRequest
    {
        public string HolidayName { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public DateTime? FromDate { get; set; }
        public DateTime? ToDate { get; set; }
        public string? HolidayType { get; set; }
        public string? Description { get; set; }
    }
}
