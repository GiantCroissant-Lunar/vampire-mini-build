using System.Diagnostics;
using System.Text;
using GitHub.Copilot.SDK;

namespace VampireMini.CopilotAgent;

/// <summary>
/// Autoresearch meta-loop: iteratively refine the playtest prompt.
/// Copilot SDK acts as meta-agent; a subprocess runs each playtest experiment.
/// </summary>
public static class MetaLoop
{
    private const string PromptFile = "playtest-prompt.md";
    private const string ResultsFile = "results.tsv";

    public static async Task RunAsync(
        CopilotSession session,
        int iterations,
        int playtestDuration,
        string outputBase)
    {
        Directory.CreateDirectory(outputBase);

        // Initialize results.tsv if it doesn't exist
        if (!File.Exists(ResultsFile))
        {
            File.WriteAllText(ResultsFile,
                "iter\tcommit\tscore\tbugs\tpatches\tcoverage\tlogs\tstatus\tdescription\n");
        }

        // Get baseline score
        int bestScore = 0;
        Console.WriteLine($"[meta] Starting autoresearch: {iterations} iterations");
        Console.WriteLine(new string('═', 60));

        for (int i = 0; i < iterations; i++)
        {
            Console.WriteLine($"\n[meta] ═══ Iteration {i}/{iterations} ═══");

            // 1. Ask meta-agent to modify the prompt
            var currentPrompt = File.Exists(PromptFile) ? File.ReadAllText(PromptFile) : "";
            var resultsHistory = File.Exists(ResultsFile) ? File.ReadAllText(ResultsFile) : "";

            var metaPrompt = $$"""
                ITERATION {{i}}/{{iterations}}. You are optimizing `playtest-prompt.md` to maximize bug discovery.

                CURRENT PROMPT ({{PromptFile}}):
                ```
                {{currentPrompt}}
                ```

                RESULTS HISTORY (results.tsv):
                ```
                {{resultsHistory}}
                ```

                SCORING: score = (bugs×10) + (patches×15) + (coverage×5) + (logs×2) - (empty×20)
                Best score so far: {{bestScore}}

                YOUR TASK:
                1. Analyze which changes improved or worsened the score
                2. Hypothesize ONE specific improvement to the prompt
                3. Write the COMPLETE new prompt content (not a diff — the full replacement)
                4. Respond with ONLY a JSON object: {"hypothesis": "what you changed and why", "prompt": "the full new prompt content"}

                RULES:
                - Make ONE focused change per iteration (don't rewrite everything)
                - If a "keep" iteration added something useful, preserve it
                - If a "discard" removed something, that removal was bad — keep the original
                - Focus on: movement patterns, observation frequency, artifact production, bug-hunting focus areas
                """;

            Console.WriteLine($"[meta] Asking meta-agent for hypothesis...");
            var response = await SendTurn(session, metaPrompt);

            // Parse the response for hypothesis + new prompt
            string hypothesis = "unknown";
            string newPrompt = currentPrompt;
            try
            {
                // Try to extract JSON from the response
                var jsonStart = response.IndexOf('{');
                var jsonEnd = response.LastIndexOf('}');
                if (jsonStart >= 0 && jsonEnd > jsonStart)
                {
                    var json = response[jsonStart..(jsonEnd + 1)];
                    var doc = System.Text.Json.JsonDocument.Parse(json);
                    hypothesis = doc.RootElement.GetProperty("hypothesis").GetString() ?? "unknown";
                    newPrompt = doc.RootElement.GetProperty("prompt").GetString() ?? currentPrompt;
                }
            }
            catch
            {
                Console.WriteLine($"[meta] Warning: could not parse JSON response, using raw text");
                hypothesis = response.Length > 80 ? response[..80] : response;
            }

            Console.WriteLine($"[meta] Hypothesis: {hypothesis}");

            // 2. Write the new prompt and git commit
            File.WriteAllText(PromptFile, newPrompt);
            var commitHash = GitCommit(i, hypothesis);

            // 3. Spawn playtest subprocess
            var iterDir = Path.Combine(outputBase, $"iter-{i}");
            Console.WriteLine($"[meta] Running playtest → {iterDir}");
            var exitCode = await RunPlaytest(playtestDuration, iterDir);
            Console.WriteLine($"[meta] Playtest completed (exit={exitCode})");

            // 4. Score results
            var score = MetaScorer.Score(iterDir);
            Console.WriteLine($"[meta] Score: {score.Total} (bugs={score.BugsFiled}, patches={score.PatchesCreated}, coverage={score.SystemsCovered}, logs={score.LogEntries})");

            // 5. Keep or discard
            string status;
            if (score.Total > bestScore)
            {
                bestScore = score.Total;
                status = "keep";
                Console.WriteLine($"[meta] ✓ KEEP — new best score: {bestScore}");
            }
            else
            {
                status = "discard";
                Console.WriteLine($"[meta] ✗ DISCARD — score {score.Total} ≤ best {bestScore}");
                // Revert the prompt change
                GitReset();
            }

            // 6. Log to results.tsv
            var row = $"{i}\t{commitHash}\t{score.Total}\t{score.BugsFiled}\t{score.PatchesCreated}\t{score.SystemsCovered}\t{score.LogEntries}\t{status}\t{hypothesis}\n";
            File.AppendAllText(ResultsFile, row);
        }

        Console.WriteLine(new string('═', 60));
        Console.WriteLine($"[meta] Autoresearch complete. Best score: {bestScore}");
        Console.WriteLine($"[meta] Results: {ResultsFile}");
        Console.WriteLine($"[meta] Final prompt: {PromptFile}");
    }

    private static async Task<int> RunPlaytest(int duration, string outputDir)
    {
        Directory.CreateDirectory(outputDir);

        // Use deterministic Node.js runner — zero LLM calls
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = $"runner.mjs --duration {duration} --prompt {PromptFile} --output {outputDir}",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };

        using var proc = Process.Start(psi);
        if (proc == null) return -1;

        _ = Task.Run(async () =>
        {
            while (!proc.StandardOutput.EndOfStream)
            {
                var line = await proc.StandardOutput.ReadLineAsync();
                if (line != null) Console.WriteLine($"  [play] {line}");
            }
        });

        await proc.WaitForExitAsync();
        return proc.ExitCode;
    }

    private static string GitCommit(int iteration, string hypothesis)
    {
        var desc = hypothesis.Length > 60 ? hypothesis[..60] : hypothesis;
        RunCmd("git", "add", PromptFile);
        RunCmd("git", "commit", "-m", $"autoresearch: iter {iteration} — {desc}", "--allow-empty");

        // Get short hash
        var psi = new ProcessStartInfo("git", "rev-parse --short HEAD")
        {
            RedirectStandardOutput = true,
            UseShellExecute = false,
        };
        using var proc = Process.Start(psi)!;
        var hash = proc.StandardOutput.ReadToEnd().Trim();
        proc.WaitForExit();
        return hash;
    }

    private static void GitReset()
    {
        RunCmd("git", "reset", "--hard", "HEAD~1");
    }

    private static void RunCmd(string cmd, params string[] args)
    {
        var psi = new ProcessStartInfo(cmd, string.Join(" ", args))
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        using var proc = Process.Start(psi)!;
        proc.WaitForExit();
    }

    private static async Task<string> SendTurn(CopilotSession session, string prompt)
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
                case SessionIdleEvent:
                    tcs.TrySetResult();
                    break;
            }
        });

        await session.SendAsync(new MessageOptions { Prompt = prompt });

        var timeout = Task.Delay(TimeSpan.FromSeconds(60));
        await Task.WhenAny(tcs.Task, timeout);

        return responseBuilder.ToString();
    }
}
