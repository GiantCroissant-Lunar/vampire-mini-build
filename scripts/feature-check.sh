#!/usr/bin/env bash
# Feature manifest check — verifies expected files exist in the game project.
# Usage: ./scripts/feature-check.sh <game-dir>
#
# Runs without Godot. Scans for expected scripts, scenes, and resources.
# Exits 0 if all required features present, 1 if any missing.

set -euo pipefail

GAME_DIR="${1:?Usage: feature-check.sh <game-dir>}"
PROJECT="$GAME_DIR/project/hosts/complete-app"
PASS=0
FAIL=0
WARN=0

check_file() {
  local label="$1"
  local path="$2"
  local required="${3:-true}"

  if [ -f "$PROJECT/$path" ]; then
    echo "  ✅ $label"
    ((PASS++))
  elif [ "$required" = "true" ]; then
    echo "  ❌ $label — missing: $path"
    ((FAIL++))
  else
    echo "  ⬜ $label — optional, not found: $path"
    ((WARN++))
  fi
}

check_class() {
  local label="$1"
  local path="$2"
  local class_name="$3"

  if [ -f "$PROJECT/$path" ]; then
    if grep -q "class $class_name" "$PROJECT/$path" 2>/dev/null; then
      echo "  ✅ $label — class $class_name found"
      ((PASS++))
    else
      echo "  ❌ $label — file exists but class $class_name not found"
      ((FAIL++))
    fi
  else
    echo "  ❌ $label — missing: $path"
    ((FAIL++))
  fi
}

check_group() {
  local label="$1"
  local path="$2"
  local group="$3"

  if [ -f "$PROJECT/$path" ]; then
    if grep -q "AddToGroup.*\"$group\"" "$PROJECT/$path" 2>/dev/null; then
      echo "  ✅ $label — adds to group \"$group\""
      ((PASS++))
    else
      echo "  ⚠️  $label — file exists but no AddToGroup(\"$group\") call found"
      ((WARN++))
    fi
  else
    echo "  ❌ $label — missing: $path"
    ((FAIL++))
  fi
}

echo "═══════════════════════════════════════"
echo " Feature Manifest Check"
echo " Project: $PROJECT"
echo "═══════════════════════════════════════"
echo ""

echo "── Player System ──"
check_class "PlayerStats"       "Scripts/Player/PlayerStats.cs"       "PlayerStats"
check_class "PlayerController"  "Scripts/Player/PlayerController.cs"  "PlayerController"
check_class "PlayerHealth"      "Scripts/Player/PlayerHealth.cs"      "PlayerHealth"
check_class "PlayerHud"         "Scripts/UI/PlayerHud.cs"             "PlayerHud"
check_class "PlayerLevel"       "Scripts/Player/PlayerLevel.cs"       "PlayerLevel"
check_group "Player group"      "Scripts/Player/PlayerController.cs"  "player"
echo ""

echo "── Enemy System ──"
check_class "EnemyStats"        "Scripts/Enemies/EnemyStats.cs"       "EnemyStats"
check_class "EnemyBase"         "Scripts/Enemies/EnemyBase.cs"        "EnemyBase"
check_class "ContactDamage"     "Scripts/Enemies/ContactDamage.cs"    "ContactDamage"
check_class "EnemySpawner"      "Scripts/Enemies/EnemySpawner.cs"     "EnemySpawner"
check_group "Enemy group"       "Scripts/Enemies/EnemyBase.cs"        "enemy"
echo ""

echo "── Weapon System ──"
check_class "WeaponStats"       "Scripts/Weapons/WeaponStats.cs"      "WeaponStats"
check_class "Projectile"        "Scripts/Weapons/Projectile.cs"       "Projectile"
check_class "WeaponBase"        "Scripts/Weapons/WeaponBase.cs"       "WeaponBase"
echo ""

echo "── Pickups ──"
check_class "XpGem"             "Scripts/Pickups/XpGem.cs"            "XpGem"
echo ""

echo "── Game Loop ──"
check_class "WaveManager"       "Scripts/Game/WaveManager.cs"         "WaveManager"
check_class "GameTimer"         "Scripts/UI/GameTimer.cs"             "GameTimer"
echo ""

echo "── Scenes ──"
check_file "Player scene"       "Scenes/Player/Player.tscn"
check_file "EnemyBase scene"    "Scenes/Enemies/EnemyBase.tscn"
check_file "Projectile scene"   "Scenes/Weapons/Projectile.tscn"
check_file "XpGem scene"        "Scenes/Pickups/XpGem.tscn"
check_file "EnemySpawner scene" "Scenes/Enemies/EnemySpawner.tscn"
check_file "WeaponBase scene"   "Scenes/Weapons/WeaponBase.tscn"      "false"
check_file "PlayerHud scene"    "Scenes/UI/PlayerHud.tscn"            "false"
echo ""

echo "── Addons ──"
check_file "Phantom Camera"     "addons/phantom_camera/plugin.cfg"    "false"
check_file "GdUnit4 (NuGet)"    "complete-app.csproj"
echo ""

echo "── Testing ──"
# Check if GdUnit4 is in csproj
if [ -f "$PROJECT/complete-app.csproj" ]; then
  if grep -q "gdUnit4" "$PROJECT/complete-app.csproj" 2>/dev/null; then
    echo "  ✅ GdUnit4 package reference found"
    ((PASS++))
  else
    echo "  ⬜ GdUnit4 package reference not in csproj yet"
    ((WARN++))
  fi
fi
# Count test files
TEST_COUNT=$(find "$PROJECT/Scripts/Tests" -name "*Test*.cs" 2>/dev/null | wc -l)
echo "  ℹ️  Test files found: $TEST_COUNT"
echo ""

echo "═══════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed, $WARN warnings"
echo "═══════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
