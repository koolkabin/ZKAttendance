using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Application.Dtos.Api;
using ZKAttendance.Domain.Entities;
using ZKAttendance.Infrastructure.Persistence;

namespace ZKAttendance.Infrastructure.Security
{
    public class JwtTokenService : ITokenService
    {
        private readonly AttendanceDbContext _context;
        private readonly IConfiguration _config;
        private readonly ILogger<JwtTokenService> _logger;

        public JwtTokenService(
            AttendanceDbContext context,
            IConfiguration config,
            ILogger<JwtTokenService> logger)
        {
            _context = context;
            _config = config;
            _logger = logger;
        }

        private string Key => _config["JwtSettings:Key"]
            ?? throw new InvalidOperationException("JwtSettings:Key is missing from appsettings.json");
        private string Issuer => _config["JwtSettings:Issuer"] ?? "ZKAttendance";
        private string Audience => _config["JwtSettings:Audience"] ?? "ZKAttendanceClients";
        private int AccessMinutes => int.TryParse(_config["JwtSettings:AccessTokenMinutes"], out var m) ? m : 60;
        private int RefreshDays => int.TryParse(_config["JwtSettings:RefreshTokenDays"], out var d) ? d : 7;


        public async Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken ct = default)
        {
            var user = await _context.ApiUsers
                .FirstOrDefaultAsync(u => u.Username == request.Username, ct);

            // Same null result for "no such user" and "wrong password", on
            // purpose. Distinguishing them tells an attacker which usernames
            // exist.
            if (user is null || !user.IsActive) return null;
            if (!PasswordHasher.VerifyPassword(request.Password, user.PasswordHash, user.PasswordSalt)) return null;

            user.LastLoginDate = DateTime.Now;
            await _context.SaveChangesAsync(ct);

            return await IssueAsync(user, ct);
        }

        public async Task<AuthResponse?> RefreshAsync(string refreshToken, CancellationToken ct = default)
        {
            var stored = await _context.RefreshTokens
                .Include(t => t.User)
                .FirstOrDefaultAsync(t => t.Token == refreshToken, ct);

            if (stored is null || !stored.IsActive || stored.User is null) return null;
            if (!stored.User.IsActive) return null;

            // Rotate: the old token is revoked as soon as it is used. If a
            // stolen copy is replayed afterwards it fails, which is how theft
            // becomes detectable rather than silent.
            stored.RevokedAt = DateTime.Now;
            await _context.SaveChangesAsync(ct);

            return await IssueAsync(stored.User, ct);
        }

        public async Task<bool> RevokeAsync(string refreshToken, CancellationToken ct = default)
        {
            var stored = await _context.RefreshTokens
                .FirstOrDefaultAsync(t => t.Token == refreshToken, ct);

            if (stored is null || stored.RevokedAt is not null) return false;

            stored.RevokedAt = DateTime.Now;
            await _context.SaveChangesAsync(ct);

            _logger.LogInformation("Refresh token revoked for user {UserId}", stored.ApiUserId);
            return true;
        }

        private async Task<AuthResponse> IssueAsync(ApiUser user, CancellationToken ct)
        {
            var expires = DateTime.UtcNow.AddMinutes(AccessMinutes);

            var claims = new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, user.ApiUserId.ToString()),
                new Claim(JwtRegisteredClaimNames.UniqueName, user.Username),
                new Claim(JwtRegisteredClaimNames.Email, user.Email),
                new Claim(ClaimTypes.Role, user.Role),
                new Claim("role", user.Role),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
            };

            var creds = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Key)),
                SecurityAlgorithms.HmacSha256);

            var jwt = new JwtSecurityToken(Issuer, Audience, claims,
                expires: expires, signingCredentials: creds);

            var refresh = new RefreshToken
            {
                ApiUserId = user.ApiUserId,
                Token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)),
                ExpiresAt = DateTime.Now.AddDays(RefreshDays),
                CreatedDate = DateTime.Now
            };

            _context.RefreshTokens.Add(refresh);
            await _context.SaveChangesAsync(ct);

            return new AuthResponse
            {
                AccessToken = new JwtSecurityTokenHandler().WriteToken(jwt),
                RefreshToken = refresh.Token,
                ExpiresAt = expires,
                Username = user.Username,
                Role = user.Role
            };
        }
    }
}
