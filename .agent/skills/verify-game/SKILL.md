---
name: verify-game
description: Build, export, launch, and verify the Godot game via WebSocket bridge. Runs Vitest scenario tests, captures screenshots and logs, then quits cleanly. Use when the user says "verify", "test the game", "run verification", "check if it works", "playtest", or after making game code changes that need runtime validation. Always operates on the exported build under build/_artifacts/latest/, never the editor.
---

# Verify Game — Automated Play Session via WebSocket Bridge

Export the Godot game, launch it, run Vitest scenario tests via the WebSocket bridge, capture screenshots and runtime logs, then quit cleanly. All artifacts are scoped to `build/_artifacts/latest/{platform}/`.

## CRITICAL: Process Lifecycle

**ALWAYS clean up processes when done.** The bridge server and game process MUST be killed after verification, whether tests pass or fail.

### Startup Sequence (in order)

```bash
# 1. Kill any lingering processes from previous runs
taskkill /F /IM vampire-survivors.exe 2>NUL
# Note: Do NOT kill all node.exe — only kill the bridge server port
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"scene.quit"}' 2>/dev/null || true

# 2. Start bridge server
cd C:\lunar-horse\contract-projects\vampire-mini-build\bridge
node server.mjs &
# Wait for server to bind (check for port 9901)
sleep 2

# 3. Launch exported game
"$ARTIFACTS/vampire-survivors.exe" &

# 4. Wait for connection
curl -s http://localhost:9901/health  # should return {"connected":true}
```

### Shutdown Sequence (ALWAYS run this, even on failure)

```bash
# 1. Graceful quit via bridge
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"scene.quit"}' 2>/dev/null || true
sleep 2

# 2. Force kill game process
taskkill /F /IM vampire-survivors.exe 2>NUL || true

# 3. Kill bridge server (the specific node process on port 9901)
# On Windows:
powershell -Command "Get-NetTCPConnection -LocalPort 9901 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
```

## When to Use

- After code changes that affect gameplay (scenes, signals, node wiring)
- After agent PRs are merged (integration verification)
- When user asks to "verify", "test", "playtest", or "check if it works"
- Scheduled verification runs (Project Shepherd)

## Prerequisites

- Godot 4.6.1 mono: `C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\`
- Node.js: `node` in PATH
- Bridge directory: `vampire-mini-build/bridge/` (with `npm install` done)
- Private repo checked out: `vampire-mini/`

## Artifact Layout

```
vampire-mini/project/hosts/complete-app/build/_artifacts/latest/
└── {platform}/
    ├── vampire-survivors.exe           # Exported game binary
    ├── session.log                     # Verification session log
    ├── scenario.log                    # Vitest scenario log
    ├── screenshot_*.png                # Captured screenshots
    ├── state_snapshots.jsonl           # Periodic state dumps
    └── test-results.json               # Vitest JSON report
```

### Platform Naming (Godot convention)

| Platform | Directory Name |
|----------|---------------|
| Windows x86_64 | `windows_debug_x86_64` or `windows_release_x86_64` |
| Linux x86_64 | `linux_debug_x86_64` or `linux_release_x86_64` |
| macOS | `macos_debug` or `macos_release` |

## Quick Run Options

### Option A: Full verify script (build + test + cleanup)

```bash
cd C:\lunar-horse\contract-projects\vampire-mini-build\bridge
node verify.mjs
```

### Option B: Vitest scenarios (requires bridge + game already running)

```bash
cd C:\lunar-horse\contract-projects\vampire-mini-build\bridge

# Run all scenarios
npm test

# Run specific scenario
npm run test:smoke
npm run test:endurance
npm run test:weapons
npm run test:levelup
npm run test:edge

# Watch mode (HMR — edits re-run instantly)
npm run test:watch
```

### Option C: Manual step-by-step

```bash
# 1. Pull & build
cd C:\lunar-horse\contract-projects\vampire-mini && git pull origin main
cd project\hosts\complete-app && dotnet build --no-restore

# 2. Export
GODOT="C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\Godot_v4.6.1-stable_mono_win64_console.exe"
"$GODOT" --headless --export-debug "Windows Desktop" "build/_artifacts/latest/windows_debug_x86_64/vampire-survivors.exe"

# 3. Start bridge
cd C:\lunar-horse\contract-projects\vampire-mini-build\bridge
node server.mjs &

# 4. Launch game
"C:\lunar-horse\contract-projects\vampire-mini\project\hosts\complete-app\build\_artifacts\latest\windows_debug_x86_64\vampire-survivors.exe" &

# 5. Wait for connection
sleep 10
curl -s http://localhost:9901/health

# 6. Run tests
npm run test:smoke

# 7. CLEANUP (mandatory)
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"scene.quit"}'
sleep 2
taskkill /F /IM vampire-survivors.exe 2>NUL
```

## Available Scenarios

| Scenario | Script | Duration | Tests |
|----------|--------|----------|-------|
| Smoke Test | `test:smoke` | ~20s | Connection, UI, player spawn, enemies |
| Survival Endurance | `test:endurance` | ~2min | FPS stability, kill rate, wave scaling |
| Weapon Stress | `test:weapons` | ~30s | Dedup, upgrades, DPS under load |
| Level-Up Gauntlet | `test:levelup` | ~45s | XP injection, menu cycling, double-click guard |
| Edge Cases | `test:edge` | ~1min | Instant death, pause spam, invalid commands, scene cycling |
| Playtest Agent | `test:playtest` | ~2min | Full gameplay loop: movement, combat, level-ups, weapon acquisition |

## Verification Checklist

| Check | How |
|-------|-----|
| Game exports without error | Godot exit code 0 |
| Game connects to bridge | `/health` returns `connected:true` within 15s |
| Player has HP | State contains `player.hp > 0` |
| Enemies spawn | State contains `enemies.alive > 0` after 10s |
| Weapons equipped | State contains `weapons` array with entries |
| No duplicate weapons | Weapon IDs are unique |
| Level-up works | XP injection triggers level_up event |
| Screenshots captured | All .png files exist and are >0 bytes |
| Game quits cleanly | `scene.quit` command succeeds |
| Player levels up | XP causes level increase and upgrade menu appears |
| Weapons acquired | Level-up grants new weapons (KnifeLauncher + others) |
| Movement works | `input.inject_move` moves player in all directions |
| **Processes cleaned up** | No vampire-survivors.exe or orphan bridge left running |

## Adding New Scenarios

Create a new file in `bridge/scenarios/`:

```typescript
// scenarios/05-my-test.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { BridgeClient, sleep } from '../src/bridge-client.js'

describe('My Test', () => {
  const bridge = new BridgeClient({ artifactsDir: '...' })

  beforeAll(async () => {
    expect(await bridge.waitForConnection(10)).toBe(true)
  })

  it('does something', async () => {
    await bridge.startGame()
    const p = await bridge.player()
    expect(p.hp).toBeGreaterThan(0)
  })
})
```

With `npm run test:watch`, the new file is auto-detected and runs immediately on save.

## Bridge Client API

```typescript
const bridge = new BridgeClient({ artifactsDir: ARTIFACTS })

// Commands
await bridge.cmd('player.heal', { amount: 50 })
await bridge.cmdOk('enemies.spawn', { count: 20 })  // throws on failure

// State
const p = await bridge.player()        // PlayerState
const w = await bridge.weapons()       // WeaponState[]
const e = await bridge.enemies()       // EnemySnapshot

// Flow
await bridge.startGame()               // from any screen
await bridge.addXpAndLevelUp(500)      // inject XP + check menu
await bridge.chooseLevelUp(1)          // pick option
await bridge.pause() / bridge.unpause()
await bridge.setTimescale(2)           // speed up

// Polling
await bridge.waitForState(s => s.enemies?.alive > 5, 10000)
await bridge.waitForGameplay()

// Artifacts
await bridge.screenshot('my_shot.png')
await bridge.snapshot('my_label')
bridge.log('Custom log entry')
```

## Tips

- **Watch mode**: `npm run test:watch` uses Vite HMR — edit a `.test.ts` and it re-runs instantly
- **Headless CI**: On Linux CI without display, use `xvfb-run` before the game executable
- **Process orphans**: Always check `tasklist | grep vampire` after testing
- **Timeouts**: Bridge commands timeout at 2s; adjust via BridgeClient options
- **State not updating**: Check that GameManager.cs is wired (it controls state broadcast data)
