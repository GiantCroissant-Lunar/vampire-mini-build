# Handover: ECS Crash & Session Summary (2026-03-22)

## Critical Blocker: Arch ECS Crash

**Status**: Arch ECS 1.2.7 crashes with `AccessViolationException` at `Chunk.GetArray/GetFirst` in Godot .NET 8 runtime on Windows. Both `World.Query` AND `World.Create` trigger the crash. Enemies cannot spawn via ECS path.

**Root cause**: The ECS Phase 2 agent merge (issue-557) added new components/systems. When the EcsWorld is created and the first entity spawn is attempted, Arch's internal chunk memory allocation faults. This is a library-level incompatibility, not a code bug.

**Direction**: Lean to everything ECS is a MUST. Do not retreat to Node2D-only. Fix the Arch issue or replace it.

### Options (evaluate in priority order)

1. **Upgrade Arch to latest** — check if 1.3.x or 2.x fixes the Godot .NET 8 crash
2. **Switch to Friflo.Engine.ECS** — proven Godot .NET compatibility, similar API
3. **Switch to DefaultEcs** — mature, lightweight, works with Godot
4. **Debug Arch** — the crash is at `Chunk.GetArray<Entity>()` which suggests unsafe memory access. May be fixable by disabling source generators or using safe query patterns
5. **Temporary hotfix**: Set `EcsSpawnRatio = 0` in GameManager to use Node2D-only spawning while ECS is fixed

### What was tried
- `_hasEntities` flag guard — doesn't help, crash in `World.Create` itself
- `World.Size > 0` check — `World.Size` also crashes
- Lazy world init (defer `World.Create` to first spawn) — world creates but crashes on first `World.Create(entity)`
- `try-catch AccessViolationException` — native crash bypasses .NET exception handling
- `World.Dispose()` + recreate on scene change — `SEHException` during disposal

## Session Work Completed

### Bugs Fixed
- [x] XP gem collision (earlier session)
- [x] ECS spawner overflow — horde mode cap check now uses combined Node2D + ECS total
- [x] KnifeProjectile ECS hit radius — 20px → 45px for reliable hits
- [x] WeaponManager.SetStartingWeapon — added WeaponSceneMap for all 11 weapons
- [x] GameServices DI init — catches GameComposition failure gracefully
- [x] EnemySpawner timer — code-created timer instead of scene-tree node
- [x] Duplicate definitions — round 3: GameComposition, TimeService, logger providers

### Agent Infrastructure
- [x] Duplicate work guard in agent-sync.yml — checks for existing branches before starting
- [x] Cleaned 79 stale branches (81 → 2)
- [x] Retriggered stuck agent issues
- [x] 50+ agent issues closed across all feature areas

### Features Created (plan issues for orchestrator)
- #553 — Full ECS migration (4 phases) — **THE priority**
- #554 — TimeService (centralized game time)
- #560 — Structured logging + DI (MS.Extensions.Logging, Pure.DI, Splat)
- #486 — PCK-based modular content system
- #487-499 — Game feel, progression, content variety, replayability (10 issues)

### Autoresearch Results
- Round 5: Best score 198 (stable bridge, 4 consecutive improvements)
- Key finding: weapons not killing enemies → traced to ECS hit radius + weapon variety
- Key finding: zero enemies spawning → traced to Arch ECS crash (this blocker)

## Files Modified This Session

### vampire-mini (private game repo)
- `Scripts/ECS/EcsWorld.cs` — lazy world init, _hasEntities guard, ResetWorld
- `Scripts/ECS/EcsEnemySpawner.cs` — timer stability fix
- `Scripts/Enemies/EnemySpawner.cs` — code-created timer, diagnostics, combined cap check
- `Scripts/Weapons/KnifeProjectile.cs` — ECS hit radius 20→45px
- `Scripts/Weapons/WeaponManager.cs` — WeaponSceneMap for all weapons
- `Scripts/Game/GameManager.cs` — random starter weapon restored
- `Scripts/DI/GameServices.cs` — fault-tolerant DI init
- `Scripts/Core/GameComposition.cs` — kept (Pure.DI partial class)
- `Scripts/System/TimeService.cs` — kept (most complete, 235 lines)
- Deleted duplicates: DI/GameComposition, Systems/TimeService, Services/TimeService, Relics/MetaProgressionManager, VFX/DamageNumberPool, Game/BiomeSchedule, System/AchievementData

### vampire-mini-build (public orchestration repo)
- `.github/workflows/agent-sync.yml` — duplicate work guard
- `copilot-agent/runner.mjs` — hardened state reads, retry logic
- `copilot-agent/MetaLoop.cs` — safe git reset (prompt only)
- `copilot-agent/playtest-prompt.md` — optimized by autoresearch

## Next Session Priorities

1. **Fix Arch ECS crash** — evaluate alternatives or upgrade
2. **Verify enemies spawn** — once ECS works, run autoresearch to confirm
3. **Weapon damage pipeline** — all weapons must hit ECS enemies (#553)
4. **PCK content system** — separate weapon/sprite content from core (#486)
5. **Clean up agent work** — more duplicates likely from ongoing agent PRs
