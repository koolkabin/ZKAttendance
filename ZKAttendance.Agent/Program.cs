using Microsoft.EntityFrameworkCore;
using ZKAttendance.Agent.Data;
using ZKAttendance.Agent.Services;
using ZKAttendance.Application.Abstractions;
using ZKAttendance.Infrastructure.Devices;

var builder = WebApplication.CreateBuilder(args);

// ═══════════════════════════════════════════════════════════════
// App2 — the local agent
//
// Runs on a PC inside the office, on the same network as the ZKTeco
// terminals. Its only job is to read punches and forward them to App1.
//
// It deliberately knows nothing about employees, departments, lateness or
// approvals. All of that stays in App1, so there is exactly one copy of the
// rules and the two apps can never disagree.
// ═══════════════════════════════════════════════════════════════

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// The agent's own small database: the outbox and a history of sync runs.
builder.Services.AddDbContext<AgentDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("AgentConnection")));

// ── talking to App1 ────────────────────────────────────────────
//
// IHttpClientFactory, not a hand-made HttpClient. One client per call
// exhausts sockets; one static client never notices a DNS change. The
// factory pools and rotates handlers, which avoids both.
builder.Services.AddHttpClient(CentralClient.HttpClientName, client =>
{
    var baseUrl = builder.Configuration["Central:BaseUrl"]
                  ?? throw new InvalidOperationException(
                      "Central:BaseUrl is not set. Point it at App1, e.g. http://192.168.1.50:5107/");

    client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : baseUrl + "/");
    client.Timeout = TimeSpan.FromSeconds(30);
});
// No resilience handler on purpose. The outbox already retries with backoff
// and survives outages of any length, so a second retry layer would only
// duplicate work and add a package that must restore before anything builds.

builder.Services.AddScoped<ICentralClient, CentralClient>();
builder.Services.AddScoped<IDeviceSyncService, DeviceSyncService>();

// ── talking to the devices ─────────────────────────────────
//
// Each vendor reader is a transient. DeviceReaderFactory resolves the right
// one based on the DeviceType that the central server returns per device row.
// Adding a new vendor: register it here and add a case to DeviceReaderFactory.
var deviceTimeoutMs = builder.Configuration.GetValue("DeviceTimeoutMs", 5000);
builder.Services.AddTransient<ZkTcpDeviceReader>(sp =>
    new ZkTcpDeviceReader(
        sp.GetRequiredService<ILogger<ZkTcpDeviceReader>>(),
        builder.Configuration.GetValue("DeviceTimeoutMs", 5000)));
builder.Services.AddTransient<FakeDeviceReader>();
builder.Services.AddTransient<HikvisionDeviceReader>();
builder.Services.AddTransient<DahuaDeviceReader>();
builder.Services.AddTransient<AnvizDeviceReader>();
builder.Services.AddTransient<eSSLDeviceReader>();
builder.Services.AddTransient<HttpPushDeviceReader>();

builder.Services.AddSingleton<IDeviceReaderFactory, DeviceReaderFactory>();

// ── background workers ─────────────────────────────────────────
//
// The drain runs on a timer rather than being triggered by a sync, so punches
// queued while the link was down go out on their own when it returns. Nobody
// has to press anything for recovery.
builder.Services.AddHostedService<OutboxDrainService>();
builder.Services.AddHostedService<HeartbeatService>();
builder.Services.AddHostedService<AutoDeviceSyncService>();

var app = builder.Build();

// Create the outbox database on first run. EnsureCreated rather than
// migrations: this schema is two tables owned by one app and is never shared,
// so migration history would be ceremony with no payoff.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AgentDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        await db.Database.EnsureCreatedAsync();
        logger.LogInformation("Agent database ready");
    }
    catch (Exception ex)
    {
        logger.LogError(ex,
            "Could not open the agent database. Check ConnectionStrings:AgentConnection.");
    }
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// The agent's page is a single static file, served from wwwroot.
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();

app.Logger.LogInformation(
    "Agent listening. Central server: {Url}",
    builder.Configuration["Central:BaseUrl"]);

app.Run();
