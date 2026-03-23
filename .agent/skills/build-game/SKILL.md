---
name: build-game
description: Build, export, and run the Vampire Mini Godot game. Use when you need to compile C#, export a debug/release build, or launch the game for testing. Also handles killing stale processes and verifying build output.
---

# Build Game

Build, export, and run the Vampire Mini Godot 4.6 + C# game.

## Prerequisites

| Tool | Path |
|------|------|
| Godot 4.6.1 mono | `C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\Godot_v4.6.1-stable_mono_win64_console.exe` |
| .NET SDK 8.0+ | `dotnet` in PATH |
| Node.js 20+ | `node` in PATH (for bridge server) |

## Project paths

```
PROJECT_DIR=C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app
BRIDGE_DIR=C:\Users\User\project-vampire-mini\vampire-mini-build\bridge
GODOT=C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\Godot_v4.6.1-stable_mono_win64_console.exe
BUILD_OUT=build/_artifacts/latest/windows_debug_x86_64/vampire-survivors.exe
```

## Commands

### 1. C# Build Only (fast — ~5s)

Use for quick compile checks without exporting.

```bash
cd "C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app" && dotnet build 2>&1 | tail -3
```

Success looks like: `建置成功。 0 個錯誤` (Build succeeded. 0 errors)

### 2. Export Debug Build (~30-60s)

Full export that produces a runnable `.exe`. **Kill any running game first** or the PCK embedding fails.

```bash
# Kill stale game process if running
tasklist /FI "IMAGENAME eq vampire-survivors.exe" 2>nul | findstr /I "vampire" && taskkill /F /IM "vampire-survivors.exe" 2>nul || echo "No running game"

# Export
cd "C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app"
"C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\Godot_v4.6.1-stable_mono_win64_console.exe" --headless --path . --export-debug "Windows Desktop" "build/_artifacts/latest/windows_debug_x86_64/vampire-survivors.exe"
```

### 3. Launch Game

```bash
"C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app\build\_artifacts\latest\windows_debug_x86_64\vampire-survivors.exe" &
```

### 4. Launch with Bridge (for automated testing)

Start the WebSocket bridge server first, then the game:

```bash
# Terminal 1: Bridge server
cd "C:\Users\User\project-vampire-mini\vampire-mini-build\bridge" && node server.mjs &

# Terminal 2: Game
"C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app\build\_artifacts\latest\windows_debug_x86_64\vampire-survivors.exe" &

# Wait for connection
sleep 8 && curl -s http://localhost:9901/health
# Expected: {"connected":true}
```

### 5. Full Pipeline: Build + Export + Launch + Verify

```bash
# Step 1: Build
cd "C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app" && dotnet build 2>&1 | tail -3

# Step 2: Kill stale processes
tasklist /FI "IMAGENAME eq vampire-survivors.exe" 2>nul | findstr /I "vampire" && taskkill /F /IM "vampire-survivors.exe" 2>nul || true

# Step 3: Export
"C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\Godot_v4.6.1-stable_mono_win64_console.exe" --headless --path . --export-debug "Windows Desktop" "build/_artifacts/latest/windows_debug_x86_64/vampire-survivors.exe"

# Step 4: Launch bridge + game
cd "C:\Users\User\project-vampire-mini\vampire-mini-build\bridge" && node server.mjs &
sleep 2
"C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app\build\_artifacts\latest\windows_debug_x86_64\vampire-survivors.exe" &

# Step 5: Verify connection
sleep 8 && curl -s http://localhost:9901/health
```

### 6. Start Game via Menu (after bridge connected)

```bash
curl -s -X POST http://localhost:9901/cmd -H "Content-Type: application/json" \
  -d '{"cmd":"ui.click_by_text","args":{"text":"Classic"}}'
sleep 2
curl -s -X POST http://localhost:9901/cmd -H "Content-Type: application/json" \
  -d '{"cmd":"ui.click_by_text","args":{"text":"Normal"}}'
```

### 7. Quit Game

```bash
curl -s -X POST http://localhost:9901/cmd -H "Content-Type: application/json" \
  -d '{"cmd":"scene.quit"}'
```

### 8. Export Release Build

```bash
cd "C:\Users\User\project-vampire-mini\vampire-mini\project\hosts\complete-app"
"C:\lunar-horse\tools\Godot_v4.6.1-stable_mono_win64\Godot_v4.6.1-stable_mono_win64_console.exe" --headless --path . --export-release "Windows Desktop" "build/_artifacts/latest/windows_release_x86_64/vampire-survivors.exe"
```

## Bridge API Quick Reference

| Command | Description |
|---------|-------------|
| `GET /health` | Connection status |
| `GET /state` | Full game state (player, enemies, weapons, wave) |
| `POST /cmd` `{"cmd":"player.heal","args":{"amount":50}}` | Heal player |
| `POST /cmd` `{"cmd":"player.set_invincible","args":{"enabled":true}}` | God mode |
| `POST /cmd` `{"cmd":"bridge.set_timescale","args":{"scale":5}}` | Speed up |
| `POST /cmd` `{"cmd":"ui.levelup_choose","args":{"option":1}}` | Auto pick upgrade |
| `POST /cmd` `{"cmd":"scene.title"}` | Return to title |
| `POST /cmd` `{"cmd":"scene.start_game"}` | Start game directly |
| `POST /cmd` `{"cmd":"scene.quit"}` | Exit game |

## Troubleshooting

- **Export fails with PCK error**: Kill running `vampire-survivors.exe` first
- **Bridge shows `{"connected":false}`**: Game hasn't connected yet, wait longer or restart
- **Build fails with CS errors**: Check `dotnet build` output for specific errors
- **Game crashes on start**: Check if `.godot/` cache is stale — run clean build
