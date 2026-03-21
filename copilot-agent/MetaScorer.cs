using System.Text.Json;

namespace VampireMini.CopilotAgent;

/// <summary>
/// Scores a playtest iteration by parsing its output artifacts.
/// Higher score = better playtest prompt.
/// </summary>
public static class MetaScorer
{
    public record ScoreResult(
        int Total,
        int BugsFiled,
        int PatchesCreated,
        int SystemsCovered,
        int LogEntries,
        bool EmptyRun);

    public static ScoreResult Score(string outputDir)
    {
        int bugsFiled = CountFiles(Path.Combine(outputDir, "bugs"), "*.json");
        int patchesCreated = CountFiles(Path.Combine(outputDir, "diffs"), "*.patch");
        int systemsCovered = CountUniqueSystems(outputDir);
        int logEntries = CountLines(Path.Combine(outputDir, "session.jsonl"));
        bool emptyRun = bugsFiled == 0 && patchesCreated == 0 && logEntries == 0;

        int total = (bugsFiled * 10) + (patchesCreated * 15) + (systemsCovered * 5)
                    + (logEntries * 2) - (emptyRun ? 20 : 0);

        return new ScoreResult(total, bugsFiled, patchesCreated, systemsCovered, logEntries, emptyRun);
    }

    private static int CountFiles(string dir, string pattern)
    {
        if (!Directory.Exists(dir)) return 0;
        return Directory.GetFiles(dir, pattern).Length;
    }

    private static int CountLines(string path)
    {
        if (!File.Exists(path)) return 0;
        return File.ReadAllLines(path).Count(l => !string.IsNullOrWhiteSpace(l));
    }

    private static int CountUniqueSystems(string outputDir)
    {
        var systems = new HashSet<string>();

        // From bug reports
        var bugsDir = Path.Combine(outputDir, "bugs");
        if (Directory.Exists(bugsDir))
        {
            foreach (var file in Directory.GetFiles(bugsDir, "*.json"))
            {
                try
                {
                    var doc = JsonDocument.Parse(File.ReadAllText(file));
                    if (doc.RootElement.TryGetProperty("system", out var sys))
                        systems.Add(sys.GetString() ?? "unknown");
                }
                catch { /* malformed json */ }
            }
        }

        // From session log
        var logPath = Path.Combine(outputDir, "session.jsonl");
        if (File.Exists(logPath))
        {
            foreach (var line in File.ReadAllLines(logPath))
            {
                try
                {
                    var doc = JsonDocument.Parse(line);
                    if (doc.RootElement.TryGetProperty("system", out var sys))
                    {
                        var val = sys.GetString();
                        if (!string.IsNullOrEmpty(val)) systems.Add(val);
                    }
                }
                catch { /* malformed */ }
            }
        }

        return systems.Count;
    }
}
