# Arch ECS v2.1.0 Upgrade Notes (2026-03-22)

## Package Changes

| Package | Old Version | New Version |
|---------|------------|-------------|
| Arch | 1.2.7 | 2.1.0 |
| Arch.System | 1.1.0 | 1.1.0 (unchanged) |
| Arch.System.SourceGenerator | 1.2.1 | 2.1.0 |

## Why This Upgrade

Arch 1.2.7 crashes with `AccessViolationException` at `Chunk.GetArray/GetFirst` in Godot .NET 8 on Windows. The crash occurs in `World.Create` (entity creation) and `World.Query` when iterating chunks. This is a library-level issue with unsafe memory access in Arch's chunk allocation.

Arch 2.0.0 release notes state: "Fixed dangerous chunk operations and proper rental mechanisms" — this directly addresses the crash vector. The v2 line also reworked query caching and archetype iteration, which were the other crash sites.

## Code Changes Made

### 1. `complete-app.csproj` — Package version bump
- `Arch` 1.2.7 → 2.1.0
- `Arch.System.SourceGenerator` 1.2.1 → 2.1.0

### 2. `EcsWorld.cs` — Query lambda signature update
In Arch v2, `Entity` is passed by value in query lambdas (not by `ref`). Three query lambdas were updated:

- `RebuildSpatialGrid()`: `(ref Entity entity, ref EcsPosition pos)` → `(Entity entity, ref EcsPosition pos)`
- `KillAllEnemies()`: `(ref Entity entity)` → `(Entity entity)`
- `DestroyAllEnemies()`: `(ref Entity entity)` → `(Entity entity)`

### 3. Source-generated systems — No changes needed
All system query methods already use `in Entity entity` which is compatible with v2.

## What Was NOT Changed (intentionally kept)

- **`_hasEntities` guard** — Kept as a safety net. Even if v2 fixes the empty-world crash, this guard is cheap and prevents unnecessary system ticks when no entities exist.
- **Lazy world creation** (`EnsureWorldCreated()`) — Same reasoning. Safe to remove later once v2 is confirmed stable.
- **`AccessViolationException` catch in `RenderEnemies()`** — Kept temporarily. Remove after confirming v2 stability.

## Testing Checklist

- [ ] `dotnet restore` succeeds (NuGet resolves Arch 2.1.0)
- [ ] `dotnet build` succeeds (no compilation errors from API changes)
- [ ] Run game in Godot — enemies spawn without AccessViolationException
- [ ] Enemies move toward player
- [ ] Weapons damage and kill ECS enemies
- [ ] XP gems drop on enemy death
- [ ] Scene transitions don't crash (ResetWorld)
- [ ] Horde mode stress test (500+ enemies)

## Fallback Plan

If Arch 2.1.0 still crashes in Godot .NET 8:
1. Revert to 1.2.7 (`git checkout -- complete-app.csproj Scripts/ECS/EcsWorld.cs`)
2. Evaluate **Friflo.Engine.ECS** (v3.4.2) — fully managed C#, no unsafe code, confirmed Godot .NET 8 compatible
3. Migration surface: ~10 system files + EcsWorld.cs coordinator. Components and spatial grid are ECS-agnostic.

## Arch v2 Breaking Changes Reference

Key changes from [Arch 2.0.0 release](https://github.com/genaray/Arch/releases):
- `Entity` now contains its Version; `EntityReference` was removed
- `World.Create()` accepts optional parameters for customization
- Queries are cached and only iterate matching archetypes
- Chunk operations reworked with proper rental mechanisms
- Bitset hash calculation fixes
