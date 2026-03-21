using System.ComponentModel;
using System.Text.Json;
using Microsoft.Extensions.AI;

namespace VampireMini.CopilotAgent.Tools;

/// <summary>
/// Registers bridge commands as Copilot SDK tools.
/// Each tool wraps a BridgeHttpClient call.
/// </summary>
public static class PlaytestTools
{
    private static readonly JsonSerializerOptions IndentedJson = new() { WriteIndented = true };

    public static AIFunction[] Create(BridgeHttpClient bridge, string outputDir)
    {
        return
        [
            // ── Observation ──────────────────────────────────────────

            AIFunctionFactory.Create(
                async () =>
                {
                    var state = await bridge.GetStateAsync();
                    return JsonSerializer.Serialize(state, IndentedJson);
                },
                "get_game_state",
                "Get the current game state: player HP/level/position, weapons, enemies alive/killed, wave info."),

            AIFunctionFactory.Create(
                async ([Description("Number of recent events to retrieve")] int count) =>
                {
                    var events = await bridge.GetEventsAsync(count);
                    return JsonSerializer.Serialize(events);
                },
                "get_recent_events",
                "Get the N most recent game events (kills, level-ups, damage, spawns)."),

            AIFunctionFactory.Create(
                async () =>
                {
                    var name = await bridge.TakeScreenshotAsync(outputDir);
                    return $"Screenshot saved: {name}";
                },
                "take_screenshot",
                "Capture a screenshot of the current game view and save it."),

            AIFunctionFactory.Create(
                async () => await bridge.SendCommandOkAsync("ui.levelup_options"),
                "get_levelup_options",
                "Check if the level-up menu is visible and get available upgrade options."),

            // ── Movement ─────────────────────────────────────────────

            AIFunctionFactory.Create(
                async (
                    [Description("Horizontal direction (-1.0 = left, 1.0 = right)")] double x,
                    [Description("Vertical direction (-1.0 = up, 1.0 = down)")] double y
                ) =>
                {
                    await bridge.SendCommandAsync("input.move", new { x, y });
                    return $"Moving direction: ({x:F1}, {y:F1})";
                },
                "move_player",
                "Move the player in a direction. Values from -1.0 to 1.0. Use (0,0) to stop."),

            AIFunctionFactory.Create(
                async () =>
                {
                    await bridge.SendCommandAsync("input.dash");
                    return "Dashed!";
                },
                "dash",
                "Perform a dash move to quickly dodge enemies."),

            // ── Progression ──────────────────────────────────────────

            AIFunctionFactory.Create(
                async ([Description("Option number to choose (1, 2, or 3)")] int option) =>
                {
                    await bridge.SendCommandAsync("ui.levelup_choose", new { option });
                    return $"Chose level-up option {option}";
                },
                "choose_levelup",
                "Choose a level-up option from the upgrade menu. Options are 1-indexed."),

            AIFunctionFactory.Create(
                async ([Description("Number of enemies to spawn")] int count) =>
                {
                    await bridge.SendCommandAsync("enemies.spawn", new { count });
                    return $"Spawned {count} enemies";
                },
                "spawn_enemies",
                "Spawn additional enemies around the player."),

            AIFunctionFactory.Create(
                async () =>
                {
                    await bridge.SendCommandAsync("enemies.kill_all");
                    return "Killed all enemies";
                },
                "kill_all_enemies",
                "Kill all currently alive enemies (emergency reset)."),

            // ── Game Flow ────────────────────────────────────────────

            AIFunctionFactory.Create(
                async () =>
                {
                    await bridge.NavigateMenuFlowAsync();
                    return "Game started via menu flow (Classic -> Start Run -> Normal -> Start Run)";
                },
                "start_game",
                "Navigate the menu and start a new game session."),

            AIFunctionFactory.Create(
                async ([Description("true to enable, false to disable")] bool enabled) =>
                {
                    await bridge.SendCommandAsync("player.set_invincible", new { enabled });
                    return $"Invincibility: {(enabled ? "ON" : "OFF")}";
                },
                "set_invincible",
                "Enable or disable player invincibility for testing."),

            AIFunctionFactory.Create(
                async ([Description("Timescale multiplier (1.0 = normal, 3.0 = 3x speed)")] double scale) =>
                {
                    await bridge.SendCommandAsync("bridge.set_timescale", new { scale });
                    return $"Timescale set to {scale}x";
                },
                "set_timescale",
                "Speed up or slow down game time."),

            AIFunctionFactory.Create(
                async ([Description("Amount of HP to restore")] int amount) =>
                {
                    await bridge.SendCommandAsync("player.heal", new { amount });
                    return $"Healed {amount} HP";
                },
                "heal_player",
                "Restore player HP by the specified amount."),

            // ── Weapons ──────────────────────────────────────────────

            AIFunctionFactory.Create(
                async ([Description("Weapon ID to add (e.g. KnifeLauncher)")] string id) =>
                {
                    await bridge.SendCommandAsync("weapons.add", new { id });
                    return $"Added weapon: {id}";
                },
                "add_weapon",
                "Add a weapon to the player's loadout."),

            AIFunctionFactory.Create(
                async () => await bridge.SendCommandOkAsync("ui.get_scene"),
                "get_ui_scene",
                "Get info about the current scene (title screen, gameplay, etc)."),

            // ══════════════════════════════════════════════════════════
            //  ARTIFACT TOOLS — output structured data for refinement
            // ══════════════════════════════════════════════════════════

            // ── Bug Report ───────────────────────────────────────────

            AIFunctionFactory.Create(
                (
                    [Description("Bug title (e.g. 'Invincibility does not prevent contact damage')")] string title,
                    [Description("critical | major | minor | cosmetic")] string severity,
                    [Description("Affected system: player, weapons, enemies, ui, camera, spawner, progression, audio, visual")] string system,
                    [Description("Step-by-step reproduction instructions")] string reproSteps,
                    [Description("What actually happened")] string actual,
                    [Description("What should have happened")] string expected,
                    [Description("File path and line number of the root cause (e.g. Scripts/Player/PlayerHealth.cs:29)")] string codeLocation,
                    [Description("Technical explanation of why this happens")] string rootCause
                ) =>
                {
                    var bugsDir = Path.Combine(outputDir, "bugs");
                    Directory.CreateDirectory(bugsDir);
                    var slug = title.ToLowerInvariant().Replace(' ', '-').Replace("'", "");
                    if (slug.Length > 50) slug = slug[..50];
                    var filename = $"{slug}.json";

                    var bug = new
                    {
                        title, severity, system, reproSteps, actual, expected,
                        codeLocation, rootCause,
                        timestamp = DateTime.UtcNow.ToString("u"),
                        agent = "copilot-playtest"
                    };
                    File.WriteAllText(
                        Path.Combine(bugsDir, filename),
                        JsonSerializer.Serialize(bug, IndentedJson));
                    return $"Bug report saved: bugs/{filename}";
                },
                "report_bug",
                "File a structured bug report with severity, repro steps, root cause, and code location. Use after investigating an issue in the source code."),

            // ── Code Diff ────────────────────────────────────────────

            AIFunctionFactory.Create(
                (
                    [Description("Short title for the fix (e.g. 'fix-invincibility')")] string title,
                    [Description("The unified diff content (standard patch format with --- a/ and +++ b/ headers)")] string diffContent,
                    [Description("What this diff fixes and why")] string description,
                    [Description("critical | major | minor")] string priority,
                    [Description("Affected systems (comma-separated: player, weapons, enemies, etc.)")] string affectedSystems,
                    [Description("How to verify this fix works (test steps)")] string verificationSteps
                ) =>
                {
                    var diffDir = Path.Combine(outputDir, "diffs");
                    Directory.CreateDirectory(diffDir);
                    var filename = $"{title}.patch";

                    var metadata = new
                    {
                        title, description, priority, affectedSystems,
                        verificationSteps,
                        timestamp = DateTime.UtcNow.ToString("u"),
                        agent = "copilot-playtest"
                    };
                    // Write metadata sidecar
                    File.WriteAllText(
                        Path.Combine(diffDir, $"{title}.meta.json"),
                        JsonSerializer.Serialize(metadata, IndentedJson));
                    // Write the actual patch
                    File.WriteAllText(Path.Combine(diffDir, filename), diffContent);
                    return $"Diff saved: diffs/{filename} (+ {title}.meta.json)";
                },
                "create_code_diff",
                "Create a .patch file with a proposed code fix plus a metadata sidecar (.meta.json) with priority, affected systems, and verification steps."),

            // ── Resource Manifest ────────────────────────────────────

            AIFunctionFactory.Create(
                (
                    [Description("JSON array of resource actions. Each entry: {\"action\":\"add|remove|update\", \"type\":\"scene|script|texture|shader|resource|audio\", \"path\":\"res://...\", \"priority\":\"critical|high|medium|low\", \"reason\":\"why\", \"depends_on\":\"optional dependency path\"}")] string manifestJson
                ) =>
                {
                    var manifestDir = Path.Combine(outputDir, "manifests");
                    Directory.CreateDirectory(manifestDir);
                    var filename = $"resources_{DateTime.UtcNow:yyyyMMdd_HHmmss}.json";
                    File.WriteAllText(Path.Combine(manifestDir, filename), manifestJson);
                    return $"Resource manifest saved: manifests/{filename}";
                },
                "create_resource_manifest",
                "Create a JSON manifest of resources that need to be added, removed, or updated. Include priority and dependencies."),

            // ── Session Log Entry ────────────────────────────────────

            AIFunctionFactory.Create(
                (
                    [Description("Log level: info | warn | error | observation")] string level,
                    [Description("Log message describing what happened")] string message,
                    [Description("Optional: affected system (player, weapons, enemies, ui, etc.)")] string system,
                    [Description("Optional: game state snapshot as JSON")] string stateJson
                ) =>
                {
                    var logPath = Path.Combine(outputDir, "session.jsonl");
                    var entry = new
                    {
                        timestamp = DateTime.UtcNow.ToString("u"),
                        level,
                        message,
                        system = string.IsNullOrEmpty(system) ? null : system,
                        state = string.IsNullOrEmpty(stateJson) ? null : stateJson
                    };
                    File.AppendAllText(logPath, JsonSerializer.Serialize(entry) + "\n");
                    return $"Logged: [{level}] {message}";
                },
                "log_observation",
                "Write a structured log entry to session.jsonl. Use for observations, warnings, errors, or interesting gameplay moments. Logs are machine-readable for CI analysis."),

            // ── Escape Hatch ─────────────────────────────────────────

            AIFunctionFactory.Create(
                async (
                    [Description("Bridge command name (e.g. player.add_xp)")] string cmd,
                    [Description("JSON arguments string (e.g. {\"amount\":100})")] string argsJson
                ) =>
                {
                    object? args = null;
                    if (!string.IsNullOrEmpty(argsJson))
                        args = JsonSerializer.Deserialize<Dictionary<string, object>>(argsJson);
                    var ack = await bridge.SendCommandAsync(cmd, args);
                    return JsonSerializer.Serialize(ack);
                },
                "send_command",
                "Send any bridge command directly. Use for commands not covered by other tools."),
        ];
    }
}
