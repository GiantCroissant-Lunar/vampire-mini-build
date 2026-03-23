---
name: autoresearch
description: Run automated playtest loops to discover gameplay bugs. Use when you need to find bugs through repeated playtesting, run QA iterations, or stress-test the game. Requires game to be running with bridge connected.
---

# Autoresearch — Automated Playtest Bug Discovery

Run the deterministic playtest runner in a loop to automatically discover gameplay bugs, crashes, and balance issues.

## Prerequisites

1. Game must be exported and running (use `build-game` skill first)
2. Bridge server must be running and connected (`curl http://localhost:9901/health` returns `{"connected":true}`)

## Quick Start

### Single playtest iteration (60s)

```bash
cd "C:\Users\User\project-vampire-mini\vampire-mini-build\copilot-agent"
node runner.mjs --duration 60 --output ./output/single-test
```

### Full autoresearch loop (10 iterations × 120s each)

```bash
cd "C:\Users\User\project-vampire-mini\vampire-mini-build\copilot-agent"
node runner.mjs --duration 120 --iterations 10 --output ./output/autoresearch-run
```

### Custom duration and iterations

```bash
node runner.mjs --duration 180 --iterations 5 --output ./output/custom-run
```

## What the Runner Does

Each iteration:
1. Resets to title screen
2. Starts a new game (Classic → Normal)
3. Speeds up to 5× timescale
4. Auto-picks level-up options
5. Samples game state every 10s
6. Detects anomalies (0 kills, stuck player, HP anomalies)
7. Saves structured JSON artifacts per iteration

## Output Structure

```
output/
├── iter-0/
│   ├── session.json     # Full state snapshots
│   ├── summary.json     # Key metrics (kills, level, duration, weapon)
│   └── bugs/            # Detected anomalies
├── iter-1/
│   └── ...
└── report.json          # Cross-iteration aggregate report
```

## Reading Results

After autoresearch completes, check the output:

```bash
# View aggregate report
cat output/autoresearch-run/report.json | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('Iterations:', d.iterations);
  console.log('Bugs found:', d.bugs?.length || 0);
  d.bugs?.forEach(b => console.log(' -', b.type, b.description));
"

# Check individual iteration summaries
cat output/autoresearch-run/iter-0/summary.json
```

## Common Bug Patterns Detected

| Pattern | Description |
|---------|-------------|
| `zero_kills` | Weapon equipped but 0 kills after 60s+ |
| `stuck_player` | Player position unchanged for 30s+ |
| `hp_anomaly` | Player HP exceeds maxHP |
| `xp_stuck` | Kills increasing but XP/level not changing |
| `spawn_stall` | No new enemies spawning despite low alive count |

## Full Pipeline: Build → Launch → Autoresearch

```bash
# 1. Build and export
cd "C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app"
dotnet build && \
"C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\Godot_v4.6.1-stable_mono_win64_console.exe" \
  --headless --path . --export-debug "Windows Desktop" \
  "build/_artifacts/latest/windows_debug_x86_64/vampire-survivors.exe"

# 2. Launch bridge + game
cd "C:\Users\User\project-vampire-mini\vampire-mini-build\bridge" && node server.mjs &
"C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app\build\_artifacts\latest\windows_debug_x86_64\vampire-survivors.exe" &
sleep 8 && curl -s http://localhost:9901/health

# 3. Run autoresearch
cd "C:\Users\User\project-vampire-mini\vampire-mini-build\copilot-agent"
node runner.mjs --duration 120 --iterations 10 --output ./output/run-$(date +%Y%m%d-%H%M)

# 4. Quit game
curl -s -X POST http://localhost:9901/cmd -H "Content-Type: application/json" -d '{"cmd":"scene.quit"}'
```
