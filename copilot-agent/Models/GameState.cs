using System.Text.Json.Serialization;

namespace VampireMini.CopilotAgent.Models;

public record GameState(
    [property: JsonPropertyName("player")] PlayerState? Player,
    [property: JsonPropertyName("weapons")] WeaponState[]? Weapons,
    [property: JsonPropertyName("passives")] PassiveState[]? Passives,
    [property: JsonPropertyName("enemies")] EnemySnapshot? Enemies,
    [property: JsonPropertyName("wave")] WaveState? Wave
);

public record PlayerState(
    [property: JsonPropertyName("hp")] double Hp,
    [property: JsonPropertyName("maxHp")] double MaxHp,
    [property: JsonPropertyName("level")] int Level,
    [property: JsonPropertyName("xp")] double Xp,
    [property: JsonPropertyName("xpToNext")] double XpToNext,
    [property: JsonPropertyName("position")] double[]? Position,
    [property: JsonPropertyName("moveSpeed")] double MoveSpeed,
    [property: JsonPropertyName("armor")] double Armor,
    [property: JsonPropertyName("damage")] double Damage
);

public record WeaponState(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("level")] int Level
);

public record PassiveState(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("level")] int Level
);

public record EnemySnapshot(
    [property: JsonPropertyName("alive")] int Alive,
    [property: JsonPropertyName("ecsAlive")] int EcsAlive,
    [property: JsonPropertyName("killed")] int Killed,
    [property: JsonPropertyName("spawnInterval")] double SpawnInterval,
    [property: JsonPropertyName("maxEnemies")] int MaxEnemies
);

public record WaveState(
    [property: JsonPropertyName("currentWave")] int CurrentWave,
    [property: JsonPropertyName("spawnInterval")] double SpawnInterval,
    [property: JsonPropertyName("difficulty")] double Difficulty,
    [property: JsonPropertyName("maxEnemies")] int MaxEnemies
);

public record AckResponse(
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("value")] object? Value,
    [property: JsonPropertyName("error")] string? Error
);

public record EventMessage(
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("event")] string? Event,
    [property: JsonPropertyName("data")] object? Data
);

public record SessionLog
{
    public List<TurnEntry> Turns { get; } = [];
    public string? Summary { get; set; }
    public GameState? FinalState { get; set; }

    public void AddTurn(int number, string response)
    {
        Turns.Add(new TurnEntry(number, DateTime.UtcNow, response));
    }
}

public record TurnEntry(int Number, DateTime Timestamp, string Response);
