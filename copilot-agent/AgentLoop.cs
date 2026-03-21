using System.Diagnostics;
using System.Text;
using GitHub.Copilot.SDK;
using VampireMini.CopilotAgent.Models;

namespace VampireMini.CopilotAgent;

public static class AgentLoop
{
    public static async Task<SessionLog> RunAsync(
        CopilotSession session,
        int durationSeconds,
        BridgeHttpClient bridge,
        string outputDir)
    {
        var log = new SessionLog();
        var sw = Stopwatch.StartNew();
        int turnNumber = 0;

        Console.WriteLine($"[agent] Starting {durationSeconds}s playtest session...");

        // Turn 0: setup — invincibility and heal must happen IMMEDIATELY after start
        var setupPrompt = """
            Start a new game session. Execute these steps IN ORDER:
            1. Call start_game to navigate through menus
            2. IMMEDIATELY call set_invincible with enabled=true (before enemies can kill you)
            3. Call heal_player with amount=9999 (in case you took damage during menu transition)
            4. Call set_timescale with scale 3.0 for faster testing
            5. Call get_game_state to confirm player is alive with HP > 0
            6. Take a screenshot of the starting state

            IMPORTANT: If get_game_state shows HP=0, call set_invincible again and heal_player again.
            """;

        var setupResponse = await SendTurn(session, setupPrompt);
        log.AddTurn(0, setupResponse);
        Console.WriteLine($"[agent] Setup complete. Starting gameplay loop.");

        // Main loop — cap at 8 play turns to conserve prompt budget
        int maxPlayTurns = 8;
        while (sw.Elapsed.TotalSeconds < durationSeconds && turnNumber < maxPlayTurns)
        {
            turnNumber++;
            var remaining = durationSeconds - (int)sw.Elapsed.TotalSeconds;
            if (remaining <= 0) break;

            var prompt = $"Turn {turnNumber}/{maxPlayTurns}. {remaining}s left. " +
                "get_game_state → move_player (vary direction) → get_levelup_options → log_observation. " +
                (turnNumber % 3 == 0 ? "Take a screenshot. " : "") +
                (turnNumber % 5 == 0 ? "spawn_enemies(10) for stress test. " : "");

            var response = await SendTurn(session, prompt);
            log.AddTurn(turnNumber, response);

            // Enforce minimum 2s between turns
            var elapsed = sw.ElapsedMilliseconds;
            var turnTime = elapsed % 2000;
            if (turnTime < 2000)
                await Task.Delay((int)(2000 - turnTime));
        }

        // Phase 2: Produce artifacts using observations from play phase
        // No file reading — the agent should use its observations to report bugs directly
        Console.WriteLine($"[agent] Phase 2: Producing bug reports and patches...");

        // Get final state for context
        string finalStateJson = "{}";
        try { finalStateJson = System.Text.Json.JsonSerializer.Serialize(await bridge.GetStateAsync()); }
        catch { /* ok */ }

        var investigatePrompt = $"""
            PHASE 2: You MUST now produce artifacts. DO NOT read any files.
            Use your observations from the play phase to immediately create outputs.

            Final game state: {finalStateJson}

            For each bug you observed, call these tools IN THIS ORDER:
            1. `report_bug` — file the bug with severity, repro steps, and your best guess at root cause/code location
            2. `create_code_diff` — if you can guess the fix based on what you observed
            3. `log_observation` — level="error" to log each confirmed bug

            DO NOT call any file read/search tools. You already know enough from playing.
            Produce 2-3 bug reports, then write your final summary.
            """;

        var summary = await SendTurn(session, investigatePrompt, timeoutSeconds: 60);
        log.Summary = summary;

        // Capture final state
        try { log.FinalState = await bridge.GetStateAsync(); }
        catch { /* game may have ended */ }

        Console.WriteLine($"[agent] Session complete. {turnNumber} turns played.");
        return log;
    }

    private static async Task<string> SendTurn(CopilotSession session, string prompt, int timeoutSeconds = 60)
    {
        var responseBuilder = new StringBuilder();
        var tcs = new TaskCompletionSource();

        session.On(evt =>
        {
            switch (evt)
            {
                case AssistantMessageEvent msg:
                    responseBuilder.Append(msg.Data.Content);
                    break;
                case AssistantMessageDeltaEvent delta:
                    responseBuilder.Append(delta.Data.DeltaContent);
                    break;
                case ToolExecutionStartEvent:
                    Console.WriteLine($"  [tool] executing...");
                    break;
                case SessionIdleEvent:
                    tcs.TrySetResult();
                    break;
            }
        });

        await session.SendAsync(new MessageOptions { Prompt = prompt });

        // Wait for session to go idle (all tool calls resolved)
        var timeoutTask = Task.Delay(TimeSpan.FromSeconds(timeoutSeconds));
        var completedTask = await Task.WhenAny(tcs.Task, timeoutTask);
        if (completedTask == timeoutTask)
            Console.WriteLine($"  [warn] Turn timed out after {timeoutSeconds}s");

        var response = responseBuilder.ToString();
        if (!string.IsNullOrWhiteSpace(response))
            Console.WriteLine($"  [llm] {Truncate(response, 120)}");

        return response;
    }

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s.Trim() : s[..max].Trim() + "...";
}
