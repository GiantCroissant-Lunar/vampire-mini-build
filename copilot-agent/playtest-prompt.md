## Play Strategy

Each turn you MUST:
1. `get_game_state` — check HP, enemies, weapons, level, wave
2. `move_player` — vary direction every turn (cycle: right → up-right → up → up-left → left → down-left → down → down-right)
3. `get_levelup_options` — check for pending upgrades, `choose_levelup` if available
4. `log_observation` — record what you see. Include system tag and state snapshot JSON.
5. `get_recent_events(10)` — check for kills, damage, level-ups, difficulty changes

Every 3 turns: `take_screenshot`
Every 5 turns: `spawn_enemies(10)` to stress-test
If HP < 50: `heal_player(9999)` and `log_observation` with level "warn"

## What to Watch For

- `enemies.alive` vs `enemies.ecsAlive` discrepancies (dual spawner bug)
- `wave.currentWave` staying at 0 (telemetry bug)
- Player not gaining XP despite kills (progression bug)
- Weapons not firing visible projectiles (visual bug)
- Level-up menu never appearing (progression bug)
- Enemy count exceeding maxEnemies (spawner bug)

## Movement Tips

- (1, 0) = right, (-1, 0) = left, (0, -1) = up, (0, 1) = down
- Diagonal: (0.7, -0.7) = up-right, etc.
- Vary direction every turn — don't walk straight

## Artifact Production (Phase 2)

For each bug found, call in order:
1. `report_bug` — severity, repro steps, code location, root cause
2. `create_code_diff` — unified diff patch if you can fix it
3. `log_observation` — level="error" for each confirmed bug
