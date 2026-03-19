namespace BridgeProtocol
{
    using System;
    using System.Collections.Generic;

    using System.Globalization;
    using Newtonsoft.Json;
    using Newtonsoft.Json.Converters;

    public partial class CommandMessage
    {
        [JsonProperty("type", Required = Required.Always)]
        public string Type { get; set; }

        [JsonProperty("id", Required = Required.Always)]
        public string Id { get; set; }

        [JsonProperty("cmd", Required = Required.Always)]
        public string Cmd { get; set; }

        [JsonProperty("args", Required = Required.Always)]
        public Args Args { get; set; }
    }

    public partial class Args
    {
        [JsonProperty("amount", Required = Required.Always)]
        public long Amount { get; set; }
    }

    public partial class AckMessage
    {
        [JsonProperty("type", Required = Required.Always)]
        public string Type { get; set; }

        [JsonProperty("id", Required = Required.Always)]
        public string Id { get; set; }

        [JsonProperty("ok", Required = Required.Always)]
        public bool Ok { get; set; }

        [JsonProperty("value", Required = Required.Always)]
        public Value Value { get; set; }

        [JsonProperty("error", Required = Required.AllowNull)]
        public object Error { get; set; }
    }

    public partial class Value
    {
        [JsonProperty("hp", Required = Required.Always)]
        public long Hp { get; set; }

        [JsonProperty("maxHp", Required = Required.Always)]
        public long MaxHp { get; set; }
    }

    public partial class StateMessage
    {
        [JsonProperty("type", Required = Required.Always)]
        public string Type { get; set; }

        [JsonProperty("player", Required = Required.Always)]
        public Player Player { get; set; }

        [JsonProperty("weapons", Required = Required.Always)]
        public Weapon[] Weapons { get; set; }

        [JsonProperty("passives", Required = Required.Always)]
        public Passive[] Passives { get; set; }

        [JsonProperty("enemies", Required = Required.Always)]
        public Enemies Enemies { get; set; }

        [JsonProperty("wave", Required = Required.Always)]
        public Wave Wave { get; set; }

        [JsonProperty("bridge", Required = Required.Always)]
        public Bridge Bridge { get; set; }
    }

    public partial class Bridge
    {
        [JsonProperty("broadcastRate", Required = Required.Always)]
        public long BroadcastRate { get; set; }

        [JsonProperty("screenshotInterval", Required = Required.Always)]
        public long ScreenshotInterval { get; set; }

        [JsonProperty("screenshotEnabled", Required = Required.Always)]
        public bool ScreenshotEnabled { get; set; }

        [JsonProperty("timescale", Required = Required.Always)]
        public long Timescale { get; set; }

        [JsonProperty("paused", Required = Required.Always)]
        public bool Paused { get; set; }
    }

    public partial class Enemies
    {
        [JsonProperty("alive", Required = Required.Always)]
        public long Alive { get; set; }

        [JsonProperty("killed", Required = Required.Always)]
        public long Killed { get; set; }

        [JsonProperty("totalSpawned", Required = Required.Always)]
        public long TotalSpawned { get; set; }
    }

    public partial class Passive
    {
        [JsonProperty("id", Required = Required.Always)]
        public string Id { get; set; }

        [JsonProperty("name", Required = Required.Always)]
        public string Name { get; set; }

        [JsonProperty("level", Required = Required.Always)]
        public long Level { get; set; }
    }

    public partial class Player
    {
        [JsonProperty("hp", Required = Required.Always)]
        public long Hp { get; set; }

        [JsonProperty("maxHp", Required = Required.Always)]
        public long MaxHp { get; set; }

        [JsonProperty("level", Required = Required.Always)]
        public long Level { get; set; }

        [JsonProperty("xp", Required = Required.Always)]
        public long Xp { get; set; }

        [JsonProperty("xpToNext", Required = Required.Always)]
        public long XpToNext { get; set; }

        [JsonProperty("position", Required = Required.Always)]
        public Position Position { get; set; }

        [JsonProperty("speed", Required = Required.Always)]
        public long Speed { get; set; }

        [JsonProperty("alive", Required = Required.Always)]
        public bool Alive { get; set; }
    }

    public partial class Position
    {
        [JsonProperty("x", Required = Required.Always)]
        public double X { get; set; }

        [JsonProperty("y", Required = Required.Always)]
        public double Y { get; set; }
    }

    public partial class Wave
    {
        [JsonProperty("currentWave", Required = Required.Always)]
        public long CurrentWave { get; set; }

        [JsonProperty("spawnInterval", Required = Required.Always)]
        public double SpawnInterval { get; set; }

        [JsonProperty("difficulty", Required = Required.Always)]
        public long Difficulty { get; set; }

        [JsonProperty("maxEnemies", Required = Required.Always)]
        public long MaxEnemies { get; set; }
    }

    public partial class Weapon
    {
        [JsonProperty("id", Required = Required.Always)]
        public string Id { get; set; }

        [JsonProperty("name", Required = Required.Always)]
        public string Name { get; set; }

        [JsonProperty("level", Required = Required.Always)]
        public long Level { get; set; }

        [JsonProperty("damage", Required = Required.Always)]
        public long Damage { get; set; }

        [JsonProperty("cooldown", Required = Required.Always)]
        public double Cooldown { get; set; }
    }

    public partial class EventMessage
    {
        [JsonProperty("type", Required = Required.Always)]
        public string Type { get; set; }

        [JsonProperty("event", Required = Required.Always)]
        public string Event { get; set; }

        [JsonProperty("data", Required = Required.Always)]
        public Data Data { get; set; }

        [JsonProperty("_eventId", Required = Required.Always)]
        public long EventId { get; set; }
    }

    public partial class Data
    {
        [JsonProperty("hp", Required = Required.Always)]
        public long Hp { get; set; }

        [JsonProperty("maxHp", Required = Required.Always)]
        public long MaxHp { get; set; }

        [JsonProperty("delta", Required = Required.Always)]
        public long Delta { get; set; }
    }

    public partial class ScreenshotMessage
    {
        [JsonProperty("type", Required = Required.Always)]
        public string Type { get; set; }

        [JsonProperty("payload", Required = Required.Always)]
        public Payload Payload { get; set; }
    }

    public partial class Payload
    {
        [JsonProperty("width", Required = Required.Always)]
        public long Width { get; set; }

        [JsonProperty("height", Required = Required.Always)]
        public long Height { get; set; }

        [JsonProperty("format", Required = Required.Always)]
        public string Format { get; set; }

        [JsonProperty("data", Required = Required.Always)]
        public string Data { get; set; }
    }
}
