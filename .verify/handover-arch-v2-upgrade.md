# Handover: Arch ECS v2.1.0 Upgrade (2026-03-22)

## Context

The game (vampire-mini) has a critical blocker: Arch ECS 1.2.7 crashes with `AccessViolationException` at `Chunk.GetArray/GetFirst` in Godot .NET 8 on Windows. Enemies cannot spawn via the ECS path. This is a library-level incompatibility, not a code bug.

We've already applied the Arch 2.1.0 upgrade in Cowork. The code changes are minimal and ready to test locally.

## What Was Already Done

### Package upgrades (complete-app.csproj)
- `Arch` 1.2.7 → 2.1.0
- `Arch.System.SourceGenerator` 1.2.1 → 2.1.0
- `Arch.System` stays at 1.1.0 (no 2.x exists)

### Code changes (EcsWorld.cs)
Three query lambdas updated from `ref Entity` to `Entity` (v2 passes Entity by value):
- `RebuildSpatialGrid()` line 218
- `KillAllEnemies()` line 443
- `DestroyAllEnemies()` line 456

All source-generated systems already use `in Entity` — no changes needed there.

### Files unchanged (intentionally)
- `_hasEntities` guard kept as safety net
- Lazy world creation (`EnsureWorldCreated()`) kept
- `AccessViolationException` catch in `RenderEnemies()` kept temporarily

## What You Need To Do

### Step 1: Verify the upgrade compiles

```bash
cd project/hosts/complete-app
dotnet restore
dotnet build
```

If build fails, check for:
- Arch 2.x API changes we missed (Entity struct changes, removed methods)
- Source generator compatibility — `Arch.System.SourceGenerator` 2.1.0 may generate different code than 1.2.1. If it errors, check the generated files in `obj/` for clues
- If `World.Create()` signature changed, check https://github.com/genaray/Arch/wiki/Quickstart

### Step 2: Run the game and test enemies

Launch in Godot. Key things to verify:
1. Game starts without crash
2. Enemies spawn (they appear as colored quads via MultiMesh)
3. Enemies move toward player
4. Weapons hit and kill enemies (knife, garlic aura, etc.)
5. XP gems drop on kill
6. No `AccessViolationException` in output log
7. Scene transitions work (ResetWorld path)
8. Stress test: survive 2+ minutes with horde mode spawning 500+ enemies

### Step 3: If upgrade works — clean up

Remove the defensive workarounds that were only there because of the 1.2.7 crash:

1. **EcsWorld.cs** — Remove the `try-catch AccessViolationException` in `RenderEnemies()` (lines 273-293). Just keep the query call.

2. **EcsWorld.cs** — Consider removing the `_hasEntities` guard and lazy world creation if the empty-world query no longer crashes. Test by:
   - Creating the World in `_Ready()` instead of deferring
   - Running a frame with no entities to confirm no crash
   - If stable, simplify `_Ready()` to create World + systems immediately

3. Update comments that reference the old crash (search for "AccessViolationException" and "Arch crashes" in EcsWorld.cs)

### Step 4: If upgrade STILL crashes — migrate to Friflo

If Arch 2.1.0 still crashes with AccessViolationException in Godot .NET 8:

**Revert first:**
```bash
git checkout -- project/hosts/complete-app/complete-app.csproj
git checkout -- project/hosts/complete-app/Scripts/ECS/EcsWorld.cs
```

**Then evaluate Friflo.Engine.ECS (v3.4.2):**
- NuGet: `Friflo.Engine.ECS` — fully managed C#, no unsafe code
- Confirmed Godot .NET 8 compatible
- Similar archetype-based API

**Migration surface (10 files + coordinator):**

| File | Complexity | Notes |
|------|-----------|-------|
| EcsWorld.cs | HIGH | Rewrite World lifecycle, queries, entity ops. 525 lines. |
| HealthSystem.cs | MEDIUM | Two queries, component mutations, entity destruction |
| ProjectileCollisionSystem.cs | MEDIUM | Spatial grid integration, damage events |
| EcsWeaponBridge.cs | MEDIUM | Entity ops (Has/Get/Add), spatial queries |
| EnemyMovementSystem.cs | LOW | Single query, velocity update |
| ContactDamageSystem.cs | LOW | Single query, distance check |
| SlowEffectSystem.cs | LOW | Timer tick, component remove |
| DamageFlashSystem.cs | LOW | Timer tick, component remove |
| ProjectileMovementSystem.cs | LOW | Single query, position update |
| ProjectileLifetimeSystem.cs | LOW | Timer countdown, mark dead |
| CleanupSystem.cs | LOW | Entity destruction loop |

**Files that DON'T need changes:**
- `EcsComponents.cs` / `ProjectileComponent.cs` — plain structs, ECS-agnostic
- `SpatialHashGrid.cs` — pure utility, uses Entity as opaque handle
- `DamageEvent.cs` — plain struct

**Friflo API mapping:**

| Arch 1.2.7 / 2.1.0 | Friflo.Engine.ECS |
|---------------------|-------------------|
| `World.Create()` | `new EntityStore()` |
| `World.Create(comp1, comp2)` | `store.CreateEntity(comp1, comp2)` |
| `World.Query(in desc, lambda)` | `store.Query<Comp1, Comp2>().ForEachEntity(...)` |
| `World.Get<T>(entity)` | `entity.GetComponent<T>()` |
| `World.Has<T>(entity)` | `entity.HasComponent<T>()` |
| `World.Add<T>(entity, val)` | `entity.AddComponent(val)` |
| `World.Remove<T>(entity)` | `entity.RemoveComponent<T>()` |
| `World.Destroy(entity)` | `entity.DeleteEntity()` |
| `World.IsAlive(entity)` | `entity.IsNull == false` |
| `World.CountEntities(query)` | `query.Count` |
| `QueryDescription().WithAll<>()` | `store.Query<AllComponents>()` |
| `[Query][All<>][None<>]` | Manual query iteration (no source gen) |

## Handover Priorities (from previous session)

After ECS is fixed:
1. **Verify enemies spawn** — run autoresearch to confirm
2. **Weapon damage pipeline** — all 11 weapons must hit ECS enemies (#553)
3. **PCK content system** — modular weapon/sprite content (#486)
4. **Clean up agent work** — check for duplicates from ongoing agent PRs

## Key Files Reference

```
vampire-mini/project/hosts/complete-app/
├── complete-app.csproj                          ← Package refs (MODIFIED)
└── Scripts/ECS/
    ├── EcsWorld.cs                              ← Central coordinator (MODIFIED)
    ├── EcsWeaponBridge.cs                       ← Weapon↔ECS bridge
    ├── EcsEnemySpawner.cs                       ← ECS spawner
    ├── SpatialHashGrid.cs                       ← Spatial queries (no Arch dep)
    ├── Components/
    │   ├── EcsComponents.cs                     ← All component structs
    │   └── ProjectileComponent.cs               ← Projectile component
    ├── Events/
    │   └── DamageEvent.cs                       ← Damage event struct
    └── Systems/
        ├── EnemyMovementSystem.cs
        ├── HealthSystem.cs
        ├── ContactDamageSystem.cs
        ├── SlowEffectSystem.cs
        ├── DamageFlashSystem.cs
        ├── ProjectileMovementSystem.cs
        ├── ProjectileLifetimeSystem.cs
        ├── ProjectileCollisionSystem.cs
        └── CleanupSystem.cs
```
