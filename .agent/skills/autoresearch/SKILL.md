---
name: autoresearch
description: Run autonomous bug-discovery loop using the autoresearch pattern. A deterministic playtest runner (zero LLM calls) plays the game via bridge, while a Copilot meta-agent iteratively refines the playtest prompt. Use when the user says "autoresearch", "find bugs autonomously", "run the discovery loop", "playtest loop", "autonomous testing", or "let the agent find bugs". Can be scheduled to run periodically after commits or overnight.
---

# Autoresearch — Autonomous Bug Discovery Loop

Iteratively refine a playtest prompt using the keep/discard pattern from Karpathy's autoresearch. A deterministic runner plays the game (zero LLM calls), while a meta-agent evaluates results and evolves the prompt.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Meta-Agent (Copilot SDK, ~2 LLM calls/iter)│
│  - Reads previous scores                    │
│  - Generates hypothesis                     │
│  - Modifies playtest-prompt.md              │
│  - Evaluates: KEEP or DISCARD               │
└──────────────┬──────────────────────────────┘
               │ spawns
┌──────────────▼──────────────────────────────┐
│  Deterministic Runner (node runner.mjs)      │
│  - Zero LLM calls                           │
│  - Plays game via bridge HTTP API            │
│  - Produces: bugs/*.json, session.jsonl,     │
│    screenshots, report.md                    │
└──────────────┬──────────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────────┐
│  Bridge Server (WebSocket relay)             │
│  ↕ Game (Godot exported build)              │
└─────────────────────────────────────────────┘
```

## Budget

| Component | LLM Calls | Cost |
|-----------|-----------|------|
| Meta-agent (per iteration) | ~2 | Copilot subscription |
| Runner (per iteration) | 0 | Free |
| **10 iterations total** | **~20** | Minimal |

## When to Use

- After merging agent PRs — verify nothing regressed
- Nightly discovery runs — find new bugs while you sleep
- After major feature additions — stress-test new systems
- When user says "find bugs", "autoresearch", "discovery loop"
- Scheduled via `mcp__scheduled-tasks` for recurring runs

## Prerequisites

- Game exported: `vampire-mini/.../build/_artifacts/latest/windows_debug_x86_64/`
- Node.js in PATH
- Bridge: `vampire-mini-build/bridge/` (npm installed)
- Copilot agent: `vampire-mini-build/copilot-agent/` (dotnet built)

## Quick Run

### Full meta-loop (recommended)

```bash
# 1. Kill any previous game/bridge
taskkill /F /IM vampire-survivors.exe 2>NUL
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"scene.quit"}' 2>/dev/null || true

# 2. Start bridge
cd C:\lunar-horse\contract-projects\vampire-mini-build\bridge
node server.mjs &
sleep 2

# 3. Launch game
"C:\lunar-horse\contract-projects\vampire-mini\project\hosts\complete-app\build\_artifacts\latest\windows_debug_x86_64\vampire-survivors.exe" &

# 4. Wait for connection
for i in $(seq 1 15); do
  curl -s http://localhost:9901/health | grep -q '"connected":true' && break
  sleep 1
done

# 5. Run autoresearch
cd C:\lunar-horse\contract-projects\vampire-mini-build\copilot-agent
dotnet run -- --meta --iterations 10 --duration 60 --output ./output

# 6. CLEANUP (mandatory)
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"scene.quit"}' 2>/dev/null || true
sleep 2
taskkill /F /IM vampire-survivors.exe 2>NUL || true
powershell -Command "Get-NetTCPConnection -LocalPort 9901 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
```

### Runner only (no meta-agent, zero LLM)

```bash
# With bridge + game already running:
cd C:\lunar-horse\contract-projects\vampire-mini-build\copilot-agent
node runner.mjs --duration 60 --output ./quick-test
```

### Scheduled run (via Claude scheduled tasks)

Create a recurring task that runs every 4 hours or after commits:

```
Task: autoresearch-nightly
Schedule: 0 2 * * * (2 AM daily)
Prompt: Run the autoresearch skill with 5 iterations, 60s each.
         Report bugs found to the user when complete.
```

## CLI Options

### Meta-loop (`dotnet run -- --meta`)

| Flag | Default | Description |
|------|---------|-------------|
| `--iterations` | 10 | Number of keep/discard iterations |
| `--duration` | 120 | Seconds per playtest |
| `--output` | `./output` | Artifact directory |

### Runner (`node runner.mjs`)

| Flag | Default | Description |
|------|---------|-------------|
| `--duration` | 120 | Seconds to play |
| `--output` | `./output` | Artifact directory |
| `--prompt` | (none) | Path to playtest-prompt.md |

## Output Structure

```
output/
├── iter-0/
│   ├── bugs/
│   │   ├── xp-not-increasing.json
│   │   └── player-stuck-level-1.json
│   ├── session.jsonl          # Timestamped observations
│   ├── report.md              # Summary with stats table
│   ├── screenshot_1.png       # Periodic captures
│   └── screenshot_final.png
├── iter-1/
│   └── ...
├── results.tsv                # Iteration scores + keep/discard
└── playtest-prompt.md         # Evolved prompt (only KEEP changes survive)
```

### Bug Report Format (bugs/*.json)

```json
{
  "title": "XP not increasing despite kills",
  "severity": "major",
  "system": "progression",
  "reproSteps": "1. Start game\n2. Kill enemies\n3. Check XP value",
  "actual": "XP stays at 0 after 33 kills",
  "expected": "XP should increase as enemies die",
  "codeLocation": "Scripts/Player/PlayerLevel.cs",
  "rootCause": "Collision layer mismatch on XpGem Area2D",
  "timestamp": "2026-03-21T07:15:42.145Z",
  "agent": "deterministic-runner"
}
```

### Scoring Formula

```
score = (bugs × 20) + (patches × 50) + (coverage × 5) + (logs × 1) - (exit≠0 ? 100 : 0)
```

## How the Keep/Discard Loop Works

1. **Meta-agent reads** previous iteration scores from `results.tsv`
2. **Generates hypothesis**: one focused change to `playtest-prompt.md`
3. **Git commits** the prompt change
4. **Runner plays** the game deterministically (zero LLM)
5. **Scorer evaluates** artifacts (bug count, coverage, log quality)
6. **Compare**: if score > best → KEEP (prompt stays), else → DISCARD (git revert prompt)
7. **Repeat** — only improvements accumulate

This mirrors Karpathy's autoresearch pattern: autonomous iteration with a keep/discard gate ensures the prompt only gets better over time.

## Proven Results

First run discovered **2 major bugs**:
- XP gems had wrong collision layers → player couldn't collect them
- All 8 pickup scenes (gems, magnets, chests) had the same issue
- Fix: `collision_layer=0, collision_mask=4` on all pickup Area2D nodes
- Bug was confirmed across all 10 iterations (100% repro rate)

## Integration with Scheduled Tasks

For hands-off operation, create a scheduled task:

```javascript
// Run every 4 hours during development
{
  taskId: "autoresearch-loop",
  cronExpression: "17 */4 * * *",  // Every 4h at :17
  prompt: "Run autoresearch: build game, start bridge, run 5 iterations of 60s each. Report any new bugs found. Clean up all processes when done.",
  description: "Autonomous bug discovery via playtest loop"
}
```

## Tips

- **Budget-safe**: 10 iterations ≈ 20 Copilot calls (runner uses zero LLM)
- **Stale game state**: Runner resets to title screen between iterations
- **Process cleanup**: Always kill game + bridge after completion
- **Long runs**: For overnight, use `--iterations 20 --duration 120`
- **Reading results**: `cat results.tsv` shows the evolution timeline
- **Best prompt**: The final `playtest-prompt.md` is the optimized version
