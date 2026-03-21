"""
HUD Verification Script
========================
Connects to the bridge HTTP API (port 9901) to verify the HUD system works.

Architecture:
  - Godot game connects via WebSocket to bridge server on port 9900
  - Agents interact via HTTP API on port 9901
  - Commands go through POST /cmd with {cmd, args} body
"""

import asyncio
import json
import sys
import urllib.request
import urllib.error
from collections import Counter

BASE_URL = "http://127.0.0.1:9901"


def http_get(path: str):
    """Sync HTTP GET"""
    try:
        req = urllib.request.Request(f"{BASE_URL}{path}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"_error": str(e)}


def http_post(path: str, body: dict):
    """Sync HTTP POST"""
    try:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            f"{BASE_URL}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"_error": str(e)}


def cmd(command: str, args: dict = None):
    """Send a bridge command via HTTP API"""
    body = {"cmd": command}
    if args:
        body["args"] = args
    return http_post("/cmd", body)


def print_result(label: str, result):
    """Pretty print a result"""
    if isinstance(result, dict) and "_error" in result:
        print(f"  FAIL  {label}: {result['_error']}")
    elif isinstance(result, dict) and result.get("ok") is False:
        print(f"  FAIL  {label}: {result.get('error', 'unknown error')}")
    else:
        print(f"  OK    {label}: {json.dumps(result, indent=2) if isinstance(result, dict) else result}")


async def main():
    print("=" * 60)
    print("HUD Verification via Bridge HTTP API")
    print("=" * 60)

    # Step 1: Wait for bridge server and game connection
    print("\n[1/6] Waiting for bridge server and game connection...")
    connected = False
    for attempt in range(12):  # up to 60 seconds
        health = http_get("/health")
        if isinstance(health, dict) and health.get("connected"):
            connected = True
            print(f"  OK    Game connected to bridge (attempt {attempt + 1})")
            break
        elif isinstance(health, dict) and "_error" in health:
            print(f"  ...   Bridge server not ready (attempt {attempt + 1}/12): {health['_error']}")
        else:
            print(f"  ...   Game not connected yet (attempt {attempt + 1}/12)")
        await asyncio.sleep(5)

    if not connected:
        print("  FAIL  Could not connect to bridge. Is the bridge server running?")
        print("        Start it with: node bridge/server.mjs")
        print("        Then launch the game (it auto-connects to ws://127.0.0.1:9900)")
        sys.exit(1)

    # Step 2: Start the game scene
    print("\n[2/6] Starting game scene...")
    result = cmd("scene.start_game")
    print_result("scene.start_game", result)

    # Wait for scene to load
    print("  ...   Waiting 3 seconds for scene to load...")
    await asyncio.sleep(3)

    # Step 3: Check initial state (verifies game is running)
    print("\n[3/6] Checking game state...")
    state = http_get("/state")
    if isinstance(state, dict) and "_error" not in state:
        player = state.get("player", {})
        print(f"  OK    Player alive={player.get('alive')}, hp={player.get('hp')}/{player.get('maxHp')}, level={player.get('level')}")
        weapons = state.get("weapons", [])
        print(f"  OK    Weapons: {[w.get('name', w.get('id')) for w in weapons]}")
        enemies = state.get("enemies", {})
        print(f"  OK    Enemies: alive={enemies.get('alive')}, killed={enemies.get('killed')}, spawned={enemies.get('totalSpawned')}")
        wave = state.get("wave", {})
        print(f"  OK    Wave: {wave.get('currentWave', '?')}, difficulty={wave.get('difficulty', '?')}")
    else:
        print_result("game state", state)

    # Step 4: Use ui.get_tree to look for HUD nodes
    print("\n[4/6] Checking scene tree for HUD nodes...")
    tree_result = cmd("ui.get_tree")
    if isinstance(tree_result, dict) and tree_result.get("ok"):
        tree_data = tree_result.get("value", "")
        tree_str = json.dumps(tree_data) if not isinstance(tree_data, str) else tree_data

        # Check for key HUD nodes
        hud_nodes = [
            "HudBridge",
            "DefaultHud",
            "KillFeedContainer",
            "GameOverPanel",
            "EnemyCountLabel",
            "TimerLabel",
            "WaveBanner",
            "WeaponBar",
            "PassiveBar",
        ]

        found = []
        missing = []
        for node in hud_nodes:
            if node.lower() in tree_str.lower():
                found.append(node)
            else:
                missing.append(node)

        print(f"  OK    Found HUD nodes ({len(found)}/{len(hud_nodes)}):")
        for n in found:
            print(f"          + {n}")
        if missing:
            print(f"  WARN  Missing HUD nodes ({len(missing)}):")
            for n in missing:
                print(f"          - {n}")
        else:
            print(f"  OK    All {len(hud_nodes)} HUD nodes present!")
    else:
        print_result("ui.get_tree", tree_result)
        print("  INFO  Trying ui.get_labels as fallback...")
        labels_result = cmd("ui.get_labels")
        print_result("ui.get_labels", labels_result)

    # Step 5: Wait for gameplay and check events
    print("\n[5/6] Waiting 5 seconds for gameplay (kills, spawns)...")
    await asyncio.sleep(5)

    # Check events for HUD-related activity
    events = http_get("/events?last=50")
    if isinstance(events, list):
        event_types = [e.get("event", "?") for e in events]
        print(f"  OK    Received {len(events)} events")
        # Count event types
        counts = Counter(event_types)
        for evt, count in counts.most_common(10):
            print(f"          {evt}: {count}")
    else:
        print_result("events", events)

    # Step 6: Check state after gameplay
    print("\n[6/6] Checking HUD state after gameplay...")
    state2 = http_get("/state")
    if isinstance(state2, dict) and "_error" not in state2:
        player = state2.get("player", {})
        enemies = state2.get("enemies", {})
        wave = state2.get("wave", {})
        weapons = state2.get("weapons", [])
        passives = state2.get("passives", [])

        print(f"  OK    Player: alive={player.get('alive')}, hp={player.get('hp')}/{player.get('maxHp')}, level={player.get('level')}, xp={player.get('xp')}")
        print(f"  OK    Enemies: alive={enemies.get('alive')}, killed={enemies.get('killed')}, spawned={enemies.get('totalSpawned')}")
        print(f"  OK    Wave: {wave.get('currentWave', '?')}")
        print(f"  OK    Weapons ({len(weapons)}): {[w.get('name', w.get('id')) for w in weapons]}")
        print(f"  OK    Passives ({len(passives)}): {[p.get('name', p.get('id')) for p in passives]}")

        # Verify HUD is tracking kills
        killed = enemies.get("killed", 0)
        spawned = enemies.get("totalSpawned", 0)
        if killed > 0:
            print(f"  OK    Kill tracking working: {killed} kills registered")
        elif spawned > 0:
            print(f"  WARN  Enemies spawned ({spawned}) but no kills yet")
        else:
            print(f"  WARN  No enemies spawned or killed yet")
    else:
        print_result("state after gameplay", state2)

    print("\n" + "=" * 60)
    print("HUD Verification Complete")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
