## Play Strategy

Each turn you MUST:
1. `get_game_state` — check HP, enemies, weapons, level, wave
2. `move_player` — vary direction every turn using this cadence: turns 1-3 follow the cycle right → up-right → up → up-left → left → down-left → down → down-right, then every 4th turn pause with `(0, 0)` for one turn before resuming the cycle
3. `get_levelup_options` — check for pending upgrades, `choose_levelup` if available
4. `log_observation` — record what you see. Include system tag, state snapshot JSON, and any delta from the previous turn that confirms or violates expected behavior
5. `get_recent_events(10)` — check for kills, damage, level-ups, difficulty changes

Every 3 turns: `take_screenshot`
Every 5 turns: `spawn_enemies(10)` to stress-test and begin a 2-turn post-spawn audit
If HP < 50: `heal_player(9999)` and `log_observation` with level "warn"

## What to Watch For

- `enemies.alive` vs `enemies.ecsAlive` discrepancies (dual spawner bug)
- `wave.currentWave` staying at 0 (telemetry bug)
- Player not gaining XP despite kills (progression bug)
- Weapons not firing visible projectiles (visual bug)
- Level-up menu never appearing (progression bug)
- Enemy count exceeding maxEnemies (spawner bug)

## State Transition Checks

Compare the current turn against the previous turn and treat broken expected transitions as bug evidence:

- If recent events show enemy kills, XP should increase within 1 turn
- If XP increases enough for a level, `get_levelup_options` should surface choices within 1 turn
- If `spawn_enemies(10)` was called, enemy counts should rise soon after but must not exceed `maxEnemies`
- If enemies are alive and weapons are equipped, combat should produce visible projectile activity or damage/kill events within a short window
- If difficulty or wave-related events appear, `wave.currentWave` should not remain stuck at 0
- If HP changes, recent events should explain why (damage taken or healing applied)

When any expected transition fails, call it out explicitly in `log_observation` as a suspected invariant break.

## Post-Spawn Audit

After every `spawn_enemies(10)` call, spend the next 2 turns explicitly auditing spawn behavior:

- Record the pre-spawn baseline from the most recent state you have: `enemies.alive`, `enemies.ecsAlive`, `wave.currentWave`, and any visible crowding
- On the next turn, verify that enemy counts increased in a believable way after the spawn request
- On the following turn, verify that counts remain internally consistent: `enemies.alive` should track `enemies.ecsAlive`, totals must not exceed `maxEnemies`, and any wave/difficulty activity should not leave `wave.currentWave` stuck at 0
- In `log_observation`, explicitly label these two turns as `post_spawn_audit` and include the before/after values
- If the post-spawn audit reveals a mismatch or overflow, treat it as strong bug evidence even if combat is still ongoing

## Anomaly Evidence Capture

When any suspected bug signal appears, capture extra visual evidence immediately on that same turn:

- If a state transition check fails, a `post_spawn_audit` mismatch appears, or game state disagrees with recent events, call `take_screenshot` immediately even if it is not the normal every-3-turn screenshot turn
- In the following `log_observation`, label the entry as `anomaly_capture` and explain exactly what the screenshot is meant to prove
- Prioritize anomaly screenshots for XP-not-increasing-after-kills, missing projectiles, enemy-count overflows, `alive` vs `ecsAlive` mismatches, and `wave.currentWave` staying at 0 despite wave or difficulty activity
- If a screenshot clearly supports the anomaly, use it as confirmation-strength evidence in bug reporting

## Movement Tips

- `(1, 0)` = right, `(-1, 0)` = left, `(0, -1)` = up, `(0, 1)` = down
- Diagonal: `(0.7, -0.7)` = up-right, etc.
- Every 4th turn, pause with `(0, 0)` to observe combat resolution, projectile visibility, XP collection, and UI behavior without movement noise
- On non-pause turns, continue the directional cycle — don't walk straight

## Bug Confirmation Rule

- Do not wait for perfect certainty if the same anomaly appears twice
- If any item in **What to Watch For** is observed in 2 consecutive turns, treat it as a confirmed bug and immediately run Phase 2 artifact production
- If a single turn shows a clear mismatch between state, screenshot, and recent events (for example kills with no XP gain, or weapons equipped with no visible projectile activity), treat it as confirmed immediately
- When confirming a bug, include the two-turn comparison or the state/screenshot mismatch in the repro notes
- A failed `post_spawn_audit` counts as confirmation-ready evidence for spawner and telemetry bugs

## Artifact Production (Phase 2)

For each bug found, call in order:
1. `report_bug` — severity, repro steps, code location, root cause
2. `create_code_diff` — unified diff patch if you can fix it
3. `log_observation` — level="error" for each confirmed bug
