using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;
using VampireMini.CopilotAgent;
using VampireMini.CopilotAgent.Tools;

// ── CLI Arguments ────────────────────────────────────────────────
var bridgeUrl = GetArg("--bridge-url", "http://127.0.0.1:9901");
var duration = int.Parse(GetArg("--duration", "180"));
var model = GetArg("--model", "gpt-5.4");
var outputDir = GetArg("--output", "./output");
var gameSourceDir = GetArg("--game-source",
    @"C:\lunar-horse\contract-projects\vampire-mini\project\hosts\complete-app");

Directory.CreateDirectory(outputDir);

// ── Verify Bridge Connection ─────────────────────────────────────
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

// ── Load System Prompt ───────────────────────────────────────────
var promptPath = Path.Combine(AppContext.BaseDirectory, "system-prompt.md");
if (!File.Exists(promptPath))
    promptPath = Path.Combine(Directory.GetCurrentDirectory(), "system-prompt.md");
var systemPrompt = File.Exists(promptPath)
    ? await File.ReadAllTextAsync(promptPath)
    : "You are a game playtest agent. Use the tools to play the game.";

// ── Create Copilot Client & Session ──────────────────────────────
Console.WriteLine($"[init] Starting Copilot client (model: {model})...");
await using var client = new CopilotClient();
await client.StartAsync();

var tools = PlaytestTools.Create(bridge, outputDir);

await using var session = await client.CreateSessionAsync(new SessionConfig
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

// ── Run Agent Loop ───────────────────────────────────────────────
var log = await AgentLoop.RunAsync(session, duration, bridge, outputDir);

// ── Write Report ─────────────────────────────────────────────────
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
