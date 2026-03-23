# Roadmap: Heavy Arch ECS v2.1.0 Adoption

**Status**: In Progress
**Created**: 2026-03-22
**Goal**: Push ECS adoption from ~55% to 90%+ by migrating remaining Node2D systems to Arch ECS v2.1.0

---

## Current State

| Area | ECS % | Notes |
|------|-------|-------|
| Enemy spawning | 50% | `EcsSpawnRatio = 0.5` — dual spawner |
| Enemy behavior (move/damage/health) | 100% | 10 source-generated systems |
| Weapon targeting | 100% | `EcsWeaponBridge` bridges all 58+ weapons |
| MultiMesh rendering | 100% | ~0.1ms per 1000 enemies |
| Projectiles | 40% | ECS storage, no pooling |
| Pickups (XP gems) | 0% | All Node2D `Area2D` |
| Status effects | ~5% | Only `SlowEffect` is ECS |
| Death VFX | 0% | ECS kills produce no particles |
| Elite enemies | 0% | Modifiers only on Node2D |
| Formations | 0% | Node2D `FormationBehavior` |
| Boss enemies | 0% | Complex AI, keep Node2D |

**Defensive workarounds still in place** (from Arch v1.2.7 crash):
1. Lazy world creation — `EnsureWorldCreated()` defers `World.Create()` until first spawn
2. `_hasEntities` guard — skips all queries when no entities exist
3. Try-catch `AccessViolationException` in `RenderEnemies()`

---

## Phase 0: Verify v2.1.0 Stability & Remove Workarounds

**Goal**: Confirm Arch 2.1.0 handles empty worlds, then strip defensive code.

**Files**:
- `Scripts/ECS/EcsWorld.cs`

**Changes**:
1. Move `World.Create()` + system init from `EnsureWorldCreated()` into `_Ready()`
2. Remove `EnsureWorldCreated()` method
3. Remove `_hasEntities` field and all guard checks
4. Remove try-catch `AccessViolationException` in `RenderEnemies()`
5. Clean up stale comments

**Test**:
- [ ] `dotnet build` passes
- [ ] Game starts, 0 enemies for 5 seconds — no crash
- [ ] Enemies spawn via ECS at default ratio
- [ ] Scene transition (die → title → restart) — no crash
- [ ] Stress: `spawner.set_ecs_ratio 1.0` + `enemies.spawn {count: 500}`

**Dependencies**: None (prerequisite for all phases)

---

## Phase 1: Quick Wins

### Phase 1A: Death VFX for ECS Kills

**Problem**: ECS enemies die silently — no particles, no screen shake, no loot burst.

**Files**:
- `Scripts/ECS/Components/EcsComponents.cs` — add `LastDamageType` to `EcsHealth`
- `Scripts/ECS/Events/DamageEvent.cs` — add `EcsDeathEvent` struct
- `Scripts/ECS/Systems/HealthSystem.cs` — collect death events in `CheckDeath`
- `Scripts/ECS/EcsWorld.cs` — dispatch VFX after system update
- `Scripts/VFX/EnemyDeathEffectManager.cs` — null-safe overloads for ECS enemies

**New struct**:
```csharp
public struct EcsDeathEvent
{
    public Vector2 Position;
    public DamageType LastDamageType;
    public int MaxHealth;
}
```

**Flow**:
1. `ProcessDamage` records `LastDamageType` on `EcsHealth`
2. `CheckDeath` collects `EcsDeathEvent` into public list
3. `EcsWorld._PhysicsProcess` iterates death events → calls `EnemyDeathEffectManager.Play()`
4. `ApplyDissolveEffect` and `SpawnRagdoll` skip gracefully when `enemy == null`

**Test**:
- [ ] Kill ECS enemies with fire weapon → fire death particles
- [ ] Kill with physical → ragdoll skipped (no sprite), particles play
- [ ] Loot burst spawns at death position

### Phase 1B: Push EcsSpawnRatio to 0.75

**File**: `Scripts/Game/GameManager.cs` line 44

**Change**: `EcsSpawnRatio` default `0.5f` → `0.75f`

**Test**:
- [ ] 75% of enemies are MultiMesh-rendered ECS entities
- [ ] 5+ minute survival run — stable
- [ ] Weapons target and kill both ECS and Node2D enemies

### Phase 1C: CommandBuffer Adoption

**Problem**: Direct `World.Destroy()` in `CleanupSystem` query causes archetype churn. `World.Add/Remove` during queries risks iterator invalidation.

**Files**:
- `Scripts/ECS/EcsWorld.cs` — add `CommandBuffer`, call `Playback()` per frame
- `Scripts/ECS/Systems/CleanupSystem.cs` — collect dead entities, defer destruction

**Pattern**:
```csharp
// CleanupSystem: collect instead of destroy
_deadEntities.Add(entity);

// EcsWorld._PhysicsProcess: batch after system update
foreach (var entity in _cleanupSystem.DeadEntities)
    World.Destroy(entity);
```

**Test**:
- [ ] Kill 500 enemies, spawn 500 more — no GC spike
- [ ] `CleanupSystem.DestroyedThisFrame` still reports correct count

---

## Phase 2: Status Effect ECS Migration

**Goal**: Bring Burn/Freeze/Poison/Shock/Curse to ECS enemies.

**New files**:
- `Scripts/ECS/Components/StatusEffectComponents.cs`
- `Scripts/ECS/Systems/BurnEffectSystem.cs`
- `Scripts/ECS/Systems/FreezeEffectSystem.cs`
- `Scripts/ECS/Systems/PoisonEffectSystem.cs`

**New components**:
```csharp
public struct BurnEffect { public float Remaining; public float DamagePerTick; public float TickInterval; public float TickTimer; }
public struct FreezeEffect { public float Remaining; public float SpeedMultiplier; }
public struct PoisonEffect { public float Remaining; public float DamagePerTick; public float TickInterval; public float TickTimer; public int Stacks; }
```

**Follow existing `SlowEffectSystem` pattern**: query with `[All<EnemyTag, XEffect>]`, tick timer, apply effect, collect expired for removal in `AfterUpdate`.

**Bridge additions** (`EcsWeaponBridge.cs`):
- `ApplyBurnInRadius(center, radius, duration, dps)`
- `ApplyFreezeInRadius(center, radius, duration, slowFactor)`
- `ApplyPoisonInRadius(center, radius, duration, dps, maxStacks)`

**Test**:
- [ ] Fire weapons apply burn to ECS enemies (ticking damage)
- [ ] Ice weapons apply freeze (slow + visual tint)
- [ ] Poison stacks correctly, ticks down
- [ ] Effects expire and components are removed

**Dependencies**: Phase 0

---

## Phase 3: Pickup ECS Migration (XP Gems)

**Goal**: Replace Node2D `XpGem.tscn` instantiation with ECS entities + second MultiMesh.

**New files**:
- `Scripts/ECS/Systems/XpGemSystem.cs` — scatter, bobbing, magnet, collection

**Component expansion** (already defined but unused):
```csharp
public struct XpGemTag
{
    public int XpValue;
    public float BobbingTimer;
    public Vector2 ScatterVelocity;
    public bool IsBeingCollected;
    public float MagnetAcceleration;
}
```

**Key design**:
- No `Area2D` collision — use distance check vs player position (same as contact damage)
- Second `MultiMeshInstance2D` for gems (smaller, different color per tier)
- Magnet/vacuum attraction via pure velocity math
- On collection: add XP to `PlayerLevel`, mark entity `Dead`

**Test**:
- [ ] ECS kills produce gem entities (not Node2D scenes)
- [ ] Gems scatter, bob, attract to player, grant XP
- [ ] 500 gems on screen — performance better than Node2D baseline

**Dependencies**: Phase 0, Phase 1C (pooling benefits gem churn)

---

## Phase 4: Elite System in ECS

**Goal**: ECS enemies can be elite with modifier components.

**New files**:
- `Scripts/ECS/Components/EliteComponents.cs`
- `Scripts/ECS/Systems/EliteModifierSystem.cs`

**Components**:
```csharp
public struct EliteTag { public int ModifierCount; }
public struct EliteAuraModifier { public float Radius; public float DamagePerSecond; }
public struct EliteSpeedModifier { public float SpeedMultiplier; }
public struct EliteRegenModifier { public float HealPerSecond; }
```

**Visual**: Gold color tint in MultiMesh for elite entities (override health-ratio coloring).

**Test**:
- [ ] ECS spawner rolls for elite at configurable chance
- [ ] Elite enemies have boosted stats + gold tint
- [ ] Elite aura damages player in radius
- [ ] DifficultyDirector elite events work with ECS

**Dependencies**: Phase 1B (high ECS ratio)

---

## Phase 5: Advanced Features

### 5A: Formation System
- Port `FormationBehavior` to ECS components + system
- Use Arch v2.1.0 entity relationships for leader/follower
- Components: `FormationMember { Entity Leader; int SlotIndex; }`, `FormationLeader`

### 5B: Boss Hybrid Entities
- Bosses remain Node2D (complex AI, cinematics, phase transitions)
- Use `GodotNodeRef` component to link boss Node2D with ECS entity for health tracking
- Enables `EcsWeaponBridge` compatibility without full migration

### 5C: World.Subscribe for Events
- Subscribe to `Dead` addition → automatic death event dispatch
- Subscribe to `EcsHealth` changes → health bar updates
- Replaces manual polling in `_PhysicsProcess`

### 5D: Push EcsSpawnRatio to 1.0
- After Phases 2-4 complete, all regular enemies are ECS
- Node2D spawner remains with `MaxEnemies = 0` as fallback
- Bosses stay Node2D via Phase 5B hybrid approach

**Dependencies**: Phases 0-4

---

## Arch v2.1.0 Features Adoption Tracker

| Feature | Current | Target Phase |
|---------|---------|-------------|
| `World.Create/Destroy` | Used | Phase 0 |
| `QueryDescription` | Used | Phase 0 |
| Source-generated `[Query]` | Used | All phases |
| `World.Query()` lambdas | Used | Phase 0 |
| `CommandBuffer` | **Not used** | Phase 1C |
| `World.Subscribe` | **Not used** | Phase 5C |
| Entity Relationships | **Not used** | Phase 5A |
| Bulk Create/Destroy | **Not used** | Phase 3 |

---

## File Reference

| File | Lines | Phases |
|------|-------|--------|
| `Scripts/ECS/EcsWorld.cs` | 526 | 0, 1A, 1C, 2, 3 |
| `Scripts/ECS/Components/EcsComponents.cs` | 97 | 1A, 2, 3, 4 |
| `Scripts/ECS/Systems/HealthSystem.cs` | 113 | 1A |
| `Scripts/ECS/Systems/CleanupSystem.cs` | 29 | 1C |
| `Scripts/ECS/EcsWeaponBridge.cs` | 201 | 2 |
| `Scripts/ECS/EcsEnemySpawner.cs` | 70 | 4 |
| `Scripts/Game/GameManager.cs` | 771 | 1B, 4, 5D |
| `Scripts/VFX/EnemyDeathEffectManager.cs` | 342 | 1A |
