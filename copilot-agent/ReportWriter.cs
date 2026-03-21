using System.Text;
using System.Text.Json;
using VampireMini.CopilotAgent.Models;

namespace VampireMini.CopilotAgent;

public static class ReportWriter
{
    public static async Task WriteAsync(SessionLog log, string outputDir, int durationSeconds, string model)
    {
        var sb = new StringBuilder();
        var now = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC");

        sb.AppendLine($"# Playtest Report - {now}");
        sb.AppendLine();

        // Config
        sb.AppendLine("## Session Config");
        sb.AppendLine($"- Duration: {durationSeconds}s");
        sb.AppendLine($"- Model: {model}");
        sb.AppendLine($"- Turns played: {log.Turns.Count}");
        sb.AppendLine();

        // Final stats
        if (log.FinalState != null)
        {
            var p = log.FinalState.Player;
            var e = log.FinalState.Enemies;
            var w = log.FinalState.Weapons ?? [];
            var passives = log.FinalState.Passives ?? [];

            sb.AppendLine("## Final Stats");
            sb.AppendLine();
            sb.AppendLine("| Metric | Value |");
            sb.AppendLine("|--------|-------|");
            if (p != null)
            {
                sb.AppendLine($"| Level | {p.Level} |");
                sb.AppendLine($"| HP | {p.Hp}/{p.MaxHp} |");
            }
            if (e != null)
                sb.AppendLine($"| Enemies Killed | {e.Killed} |");
            sb.AppendLine($"| Weapons | {string.Join(", ", w.Select(x => $"{x.Id}(lv{x.Level})"))} |");
            sb.AppendLine($"| Passives | {string.Join(", ", passives.Select(x => $"{x.Id}(lv{x.Level})"))} |");
            sb.AppendLine();
        }

        // LLM Summary
        if (!string.IsNullOrWhiteSpace(log.Summary))
        {
            sb.AppendLine("## Agent Summary");
            sb.AppendLine();
            sb.AppendLine(log.Summary);
            sb.AppendLine();
        }

        // Turn log (condensed)
        sb.AppendLine("## Turn Log");
        sb.AppendLine();
        foreach (var turn in log.Turns)
        {
            var ts = turn.Timestamp.ToString("HH:mm:ss");
            var condensed = turn.Response.Length > 200
                ? turn.Response[..200].Trim() + "..."
                : turn.Response.Trim();
            sb.AppendLine($"**Turn {turn.Number}** [{ts}]: {condensed}");
            sb.AppendLine();
        }

        // Screenshots
        var screenshots = Directory.GetFiles(outputDir, "screenshot_*.png");
        if (screenshots.Length > 0)
        {
            sb.AppendLine("## Screenshots");
            sb.AppendLine();
            foreach (var path in screenshots.OrderBy(p => p))
                sb.AppendLine($"- ![{Path.GetFileName(path)}]({Path.GetFileName(path)})");
            sb.AppendLine();
        }

        var reportPath = Path.Combine(outputDir, "report.md");
        await File.WriteAllTextAsync(reportPath, sb.ToString());
        Console.WriteLine($"[report] Written to {reportPath}");
    }
}
