using System.Text.Json;
using VampireMini.CopilotAgent.Models;

namespace VampireMini.CopilotAgent;

/// <summary>
/// C# port of bridge-client.ts — HTTP wrapper for the bridge server API.
/// </summary>
public class BridgeHttpClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private int _screenshotCount;

    public BridgeHttpClient(string baseUrl = "http://127.0.0.1:9901")
    {
        _baseUrl = baseUrl;
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<bool> IsConnectedAsync()
    {
        try
        {
            var resp = await _http.GetStringAsync($"{_baseUrl}/health");
            return resp.Contains("\"connected\":true", StringComparison.Ordinal);
        }
        catch { return false; }
    }

    public async Task<GameState> GetStateAsync()
    {
        var json = await _http.GetStringAsync($"{_baseUrl}/state");
        return JsonSerializer.Deserialize<GameState>(json)
            ?? throw new InvalidOperationException("Failed to parse game state");
    }

    public async Task<AckResponse> SendCommandAsync(string cmd, object? args = null)
    {
        var body = new Dictionary<string, object?> { ["cmd"] = cmd };
        if (args != null) body["args"] = args;

        var content = new StringContent(
            JsonSerializer.Serialize(body),
            System.Text.Encoding.UTF8,
            "application/json");

        var resp = await _http.PostAsync($"{_baseUrl}/cmd", content);
        resp.EnsureSuccessStatusCode();

        var json = await resp.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<AckResponse>(json)
            ?? new AckResponse("ack", null, false, null, "Failed to parse response");
    }

    public async Task<string> SendCommandOkAsync(string cmd, object? args = null)
    {
        var ack = await SendCommandAsync(cmd, args);
        if (!ack.Ok)
            throw new InvalidOperationException($"Command '{cmd}' failed: {ack.Error}");
        return JsonSerializer.Serialize(ack.Value);
    }

    public async Task<EventMessage[]> GetEventsAsync(int last = 20)
    {
        var json = await _http.GetStringAsync($"{_baseUrl}/events?last={last}");
        return JsonSerializer.Deserialize<EventMessage[]>(json) ?? [];
    }

    public async Task<string> TakeScreenshotAsync(string outputDir)
    {
        await SendCommandAsync("bridge.screenshot");
        await Task.Delay(1500);

        var bytes = await _http.GetByteArrayAsync($"{_baseUrl}/screenshot.png");
        if (bytes.Length < 100) throw new InvalidOperationException("Screenshot too small");

        var name = $"screenshot_{++_screenshotCount}.png";
        var path = Path.Combine(outputDir, name);
        await File.WriteAllBytesAsync(path, bytes);
        return name;
    }

    /// <summary>
    /// Navigate the full menu flow: Title → Classic → Start Run → Normal → Start Run.
    /// Mirrors BridgeClient.navigateMenuFlow() from bridge-client.ts.
    /// </summary>
    public async Task NavigateMenuFlowAsync()
    {
        await SendCommandAsync("ui.click_by_text", new { text = "Classic" });
        await Task.Delay(2000);
        await SendCommandAsync("ui.click_by_text", new { text = "Start Run" });
        await Task.Delay(2000);
        await SendCommandAsync("ui.click_by_text", new { text = "Normal" });
        await Task.Delay(2000);
        await SendCommandAsync("ui.click_by_text", new { text = "Start Run" });
        await Task.Delay(3000);
    }

    public void Dispose() => _http.Dispose();
}
