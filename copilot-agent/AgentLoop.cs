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

        // Main loop
        while (sw.Elapsed.TotalSeconds < durationSeconds)
        {
            turnNumber++;
            var remaining = durationSeconds - (int)sw.Elapsed.TotalSeconds;
            if (remaining <= 0) break;

            var prompt = $"""
                Turn {turnNumber}. {remaining}s remaining.
                Observe the game state, then make your next gameplay decisions:
                - Move in a direction (vary your movement pattern)
                - Check for and handle any level-up menus
                - Note anything interesting or buggy
                """;

            // Take periodic screenshots
            if (turnNumber % 5 == 0)
                prompt += "\n- Take a screenshot this turn.";

            var response = await SendTurn(session, prompt);
            log.AddTurn(turnNumber, response);

            // Enforce minimum 2s between turns
            var elapsed = sw.ElapsedMilliseconds;
            var turnTime = elapsed % 2000;
            if (turnTime < 2000)
                await Task.Delay((int)(2000 - turnTime));
        }

        // Phase 2: Investigate & Fix
        Console.WriteLine($"[agent] Phase 2: Investigating bugs and fixing code...");
        var investigatePrompt = """
            The play phase is over. Now switch to investigation mode.

            1. Take a final screenshot and observe the final game state
            2. List all bugs and issues you noticed during gameplay
            3. For each bug, read the relevant source code files to understand the root cause
            4. If the fix is straightforward (< 20 lines changed), apply it directly
            5. If the fix is complex, document the root cause with file paths and line numbers

            Focus on gameplay-breaking bugs first, then visual issues, then balance.
            Use the file tools (read, edit, grep) to explore the codebase.
            The game source is in the current working directory.

            After investigating, write your final playtest report covering:
            - Stats: level, kills, weapons, passives
            - Bugs found: with file paths and root cause
            - Fixes applied: what you changed and why
            - Remaining issues: what needs manual attention
            """;

        var summary = await SendTurn(session, investigatePrompt, timeoutSeconds: 180);
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
