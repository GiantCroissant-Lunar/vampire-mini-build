---
name: verify-game
description: Build, export, launch, and verify the Godot game via WebSocket bridge. Runs a scripted play session, captures screenshots and logs, then quits. Use when the user says "verify", "test the game", "run verification", "check if it works", "playtest", or after making game code changes that need runtime validation. Always operates on the exported build under build/_artifacts/latest/, never the editor.
---

# Verify Game — Automated Play Session via WebSocket Bridge

Export the Godot game, launch it, run a scripted verification session via the WebSocket bridge, capture screenshots and runtime logs, then quit cleanly. All artifacts are scoped to `build/_artifacts/latest/{platform}/`.

## When to Use

- After code changes that affect gameplay (scenes, signals, node wiring)
- After agent PRs are merged (integration verification)
- When user asks to "verify", "test", "playtest", or "check if it works"
- Scheduled verification runs (Project Shepherd)

## Prerequisites

- Godot 4.6.1 mono: `C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\`
- Node.js (for bridge server): `node` in PATH
- Bridge server: `vampire-mini-build/bridge/server.mjs`
- Private repo checked out: `vampire-mini/`

## Artifact Layout

All verification outputs go under the **private repo's** build artifacts directory:

```
vampire-mini/project/hosts/complete-app/build/_artifacts/latest/
└── {platform}/
    ├── vampire-survivors.exe           # Exported game binary
    ├── vampire-survivors.console.exe   # Console wrapper
    ├── data_complete-app_{platform}    # .NET assemblies
    ├── session.log                     # Verification session log
    ├── screenshot_title.png            # Title screen capture
    ├── screenshot_gameplay_10s.png     # 10s into gameplay
    ├── screenshot_gameplay_30s.png     # 30s into gameplay
    ├── screenshot_game_over.png        # Game over screen (if reached)
    └── state_snapshots.jsonl           # Periodic state dumps
```

### Platform Naming (Godot convention)

| Platform | Directory Name |
|----------|---------------|
| Windows x86_64 | `windows_debug_x86_64` or `windows_release_x86_64` |
| Linux x86_64 | `linux_debug_x86_64` or `linux_release_x86_64` |
| macOS | `macos_debug` or `macos_release` |
| Web | `web_debug` or `web_release` |

## Step-by-Step Procedure

### 1. Pull Latest Code

```bash
cd C:\lunar-horse\contract-projects\vampire-mini
git pull origin main
```

### 2. Update Export Presets

The export path MUST point to the artifacts directory:

```
build/_artifacts/latest/windows_debug_x86_64/vampire-survivors.exe
```

Edit `export_presets.cfg` if needed:
```ini
export_path="build/_artifacts/latest/windows_debug_x86_64/vampire-survivors.exe"
```

### 3. Build & Export

```bash
GODOT="C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\Godot_v4.6.1-stable_mono_win64_console.exe"
PROJECT="C:\lunar-horse\contract-projects\vampire-mini\project\hosts\complete-app"
ARTIFACTS="$PROJECT/build/_artifacts/latest/windows_debug_x86_64"

mkdir -p "$ARTIFACTS"

# C# build first (fast fail on compile errors)
cd "$PROJECT" && dotnet build --no-restore

# Godot export
"$GODOT" --headless --path "$PROJECT" --export-debug "Windows Desktop" "$ARTIFACTS/vampire-survivors.exe"
```

### 4. Start Bridge Server

```bash
cd C:\lunar-horse\contract-projects\vampire-mini-build\bridge
node server.mjs &
# Wait for server to bind
sleep 1
```

Kill any existing server first:
```bash
# Windows
taskkill /F /IM node.exe 2>/dev/null || true
```

### 5. Launch Game

```bash
"$ARTIFACTS/vampire-survivors.exe" &
```

Wait for WebSocket connection:
```bash
# Poll until connected (max 15s)
for i in $(seq 1 15); do
  HEALTH=$(curl -s http://localhost:9901/health 2>/dev/null)
  if echo "$HEALTH" | grep -q '"connected":true'; then
    break
  fi
  sleep 1
done
```

### 6. Run Verification Session

Execute commands via the HTTP API (`POST http://localhost:9901/cmd`).

#### Phase 1: Title Screen (0-3s)
```bash
# Capture title screen
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"bridge.screenshot"}'
# Save screenshot from /screenshot.png
curl -s http://localhost:9901/screenshot.png -o "$ARTIFACTS/screenshot_title.png"

# Check visible buttons
BUTTONS=$(curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"ui.get_buttons"}')
echo "[VERIFY] Title buttons: $BUTTONS" >> "$ARTIFACTS/session.log"

# Start the game via MessagePipe
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"scene.start_game"}'
sleep 2
```

#### Phase 2: Early Gameplay (3-15s)
```bash
# Verify player exists and has HP
STATE=$(curl -s http://localhost:9901/state)
echo "[VERIFY] Initial state: $STATE" >> "$ARTIFACTS/session.log"

# Check core systems
HP=$(echo "$STATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).player?.hp??'MISSING'))")
echo "[VERIFY] Player HP: $HP" >> "$ARTIFACTS/session.log"

# Wait 10s for enemies to spawn and interact
sleep 10
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"bridge.screenshot"}'
sleep 0.5
curl -s http://localhost:9901/screenshot.png -o "$ARTIFACTS/screenshot_gameplay_10s.png"

# Snapshot state
curl -s http://localhost:9901/state >> "$ARTIFACTS/state_snapshots.jsonl"
echo "" >> "$ARTIFACTS/state_snapshots.jsonl"
```

#### Phase 3: Mid Gameplay (15-35s)
```bash
# Add XP to trigger level-up
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"player.add_xp","args":{"amount":100}}'
sleep 1

# Check if level-up menu appeared
LEVELUP=$(curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"ui.levelup_options"}')
echo "[VERIFY] Level-up options: $LEVELUP" >> "$ARTIFACTS/session.log"

# Choose option 1 if menu is visible
echo "$LEVELUP" | grep -q '"visible":true' && \
  curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"ui.levelup_choose","args":{"option":1}}'

# Spawn extra enemies to test combat
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"enemies.spawn","args":{"count":20}}'

sleep 15
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"bridge.screenshot"}'
sleep 0.5
curl -s http://localhost:9901/screenshot.png -o "$ARTIFACTS/screenshot_gameplay_30s.png"

# Snapshot state
curl -s http://localhost:9901/state >> "$ARTIFACTS/state_snapshots.jsonl"
echo "" >> "$ARTIFACTS/state_snapshots.jsonl"
```

#### Phase 4: Collect Events & Final State
```bash
# Dump all events
curl -s "http://localhost:9901/events?last=100" >> "$ARTIFACTS/session.log"
echo "" >> "$ARTIFACTS/session.log"

# Final state
FINAL=$(curl -s http://localhost:9901/state)
echo "[VERIFY] Final state: $FINAL" >> "$ARTIFACTS/session.log"
```

### 7. Quit Game & Cleanup

```bash
# Quit via bridge command
curl -s -X POST http://localhost:9901/cmd -d '{"cmd":"scene.quit"}'
sleep 2

# Kill bridge server
taskkill /F /IM node.exe 2>/dev/null || true
```

### 8. Validate Results

After the session, check the artifacts:

```bash
# Must exist
ls "$ARTIFACTS/vampire-survivors.exe"
ls "$ARTIFACTS/screenshot_title.png"
ls "$ARTIFACTS/screenshot_gameplay_10s.png"
ls "$ARTIFACTS/session.log"

# Log must contain state data
grep -q "player" "$ARTIFACTS/session.log" && echo "PASS: Player state recorded"
grep -q "hp" "$ARTIFACTS/session.log" && echo "PASS: HP tracked"
```

## Verification Checklist

The verification PASSES if all of these are true:

| Check | How |
|-------|-----|
| Game exports without error | Godot exit code 0 |
| Game connects to bridge | `/health` returns `connected:true` within 15s |
| Title screen has Start button | `ui.get_buttons` returns StartButton |
| Game starts via command | `scene.start_game` returns success |
| Player has HP | State contains `player.hp > 0` |
| Enemies spawn | State contains `enemies.alive > 0` after 10s |
| Weapons equipped | State contains `weapons` array with entries |
| Level-up works | XP injection triggers level_up event |
| Screenshots captured | All .png files exist and are >0 bytes |
| Game quits cleanly | `scene.quit` command succeeds |

## Quick Run (Single Command)

For convenience, a verification script is provided:

```bash
cd C:\lunar-horse\contract-projects\vampire-mini-build\bridge
node verify.mjs
```

This runs the full verification pipeline and exits with code 0 (pass) or 1 (fail).

## Integration with Pipeline

The integration workflow can call this skill after merging agent branches:

```yaml
- name: Verify exported game
  run: |
    cd bridge && node verify.mjs
  timeout-minutes: 3
```

## Tips

- **Headless CI**: On Linux CI without a display, use `xvfb-run` before the game executable
- **Timeouts**: If the game hangs, the bridge server's 2s command timeout will catch it
- **Flaky tests**: Enemy spawn positions are random — check counts, not positions
- **Screenshots**: Compare screenshots visually to catch rendering regressions
- **State snapshots**: JSONL format makes it easy to diff between runs
