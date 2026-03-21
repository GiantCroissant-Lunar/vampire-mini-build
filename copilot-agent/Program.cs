using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;
using VampireMini.CopilotAgent;
using VampireMini.CopilotAgent.Tools;

// ── CLI Arguments ────────────────────────────────────────────────
var bridgeUrl = GetArg("--bridge-url", "http://127.0.0.1:9901");
var duration = int.Parse(GetArg("--duration", "120"));
var model = GetArg("--model", "gpt-5.4");
var outputDir = GetArg("--output", "./output");
var gameSourceDir = GetArg("--game-source",
    @"C:\lunar-horse\contract-projects\vampire-mini\project\hosts\complete-app");
var promptFile = GetArg("--prompt", "");
var metaMode = args.Contains("--meta");
var iterations = int.Parse(GetArg("--iterations", "5"));

// ══════════════════════════════════════════════════════════════════
//  META MODE — autoresearch loop (Copilot = meta-agent)
// ══════════════════════════════════════════════════════════════════
if (metaMode)
{
    Console.WriteLine($"[meta] Autoresearch mode — {iterations} iterations, {duration}s per playtest");

    await using var client = new CopilotClient();
    await client.StartAsync();

    await using var session = await client.CreateSessionAsync(new SessionConfig
    {
        Model = model,
        OnPermissionRequest = PermissionHandler.ApproveAll,
    });

    await MetaLoop.RunAsync(session, iterations, duration, outputDir);
    return 0;
}

// ══════════════════════════════════════════════════════════════════
//  PLAYTEST MODE — single run (existing behavior)
// ══════════════════════════════════════════════════════════════════
Directory.CreateDirectory(outputDir);

// Verify bridge connection
using var bridge = new BridgeHttpClient(bridgeUrl);
Console.WriteLine($"[init] Connecting to bridge at {bridgeUrl}...");

for (int i = 0; i < 15; i++)
{
    if (await bridge.IsConnectedAsync())
    {
        Console.WriteLine("[init] Bridge connected.");
        break;
    }
    if (i == 14) { Console.Error.WriteLine("[error] Bridge not connected after 15s. Is the game running?"); return 1; }
    await Task.Delay(1000);
}

// Load prompt — either from --prompt flag or system-prompt.md
string systemPrompt;
if (!string.IsNullOrEmpty(promptFile) && File.Exists(promptFile))
{
    // Load the base system prompt + append the playtest-specific prompt
    var basePath = Path.Combine(AppContext.BaseDirectory, "system-prompt.md");
    if (!File.Exists(basePath))
        basePath = Path.Combine(Directory.GetCurrentDirectory(), "system-prompt.md");
    var basePrompt = File.Exists(basePath) ? await File.ReadAllTextAsync(basePath) : "";
    var playtestPrompt = await File.ReadAllTextAsync(promptFile);
    systemPrompt = basePrompt + "\n\n" + playtestPrompt;
}
else
{
    var promptPath = Path.Combine(AppContext.BaseDirectory, "system-prompt.md");
    if (!File.Exists(promptPath))
        promptPath = Path.Combine(Directory.GetCurrentDirectory(), "system-prompt.md");
    systemPrompt = File.Exists(promptPath)
        ? await File.ReadAllTextAsync(promptPath)
        : "You are a game playtest agent. Use the tools to play the game.";
}

// Create Copilot client & session
Console.WriteLine($"[init] Starting Copilot client (model: {model})...");
await using var client2 = new CopilotClient();
await client2.StartAsync();

var tools = PlaytestTools.Create(bridge, outputDir);

await using var session2 = await client2.CreateSessionAsync(new SessionConfig
{
    Model = model,
    Tools = tools,
    WorkingDirectory = gameSourceDir,
    SystemMessage = new SystemMessageConfig
    {
        Mode = SystemMessageMode.Append,
        Content = systemPrompt,
    },
    OnPermissionRequest = PermissionHandler.ApproveAll,
});

Console.WriteLine($"[init] Session created. Running {duration}s playtest...");
Console.WriteLine(new string('─', 60));

var log = await AgentLoop.RunAsync(session2, duration, bridge, outputDir);

Console.WriteLine(new string('─', 60));
await ReportWriter.WriteAsync(log, outputDir, duration, model);

Console.WriteLine("[done] Playtest complete.");
return 0;

// ── Helpers ──────────────────────────────────────────────────────
string GetArg(string name, string defaultValue)
{
    var idx = Array.IndexOf(args, name);
    return idx >= 0 && idx + 1 < args.Length ? args[idx + 1] : defaultValue;
}
