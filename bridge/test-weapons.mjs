#!/usr/bin/env node
/**
 * Weapon Verification Script v2
 * For each weapon:
 * 1. Restart the game fresh via scene.start_game
 * 2. Set high HP
 * 3. Remove default weapons (GarlicAura, KnifeLauncher)
 * 4. Add the test weapon
 * 5. Spawn enemies close to player
 * 6. Wait and check kill count
 * 7. Take debug screenshot
 */

const BASE = 'http://localhost:9901';
const TEST_SECONDS = 25;

async function cmd(command, args) {
  const body = { cmd: command };
  if (args) body.args = args;
  const res = await fetch(`${BASE}/cmd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function getState() {
  const res = await fetch(`${BASE}/state`);
  return res.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function dismissLevelUp() {
  for (let i = 0; i < 3; i++) {
    const lu = await cmd('ui.levelup_options');
    if (lu.ok && lu.value?.visible) {
      await cmd('ui.levelup_choose', { option: 1 });
      await sleep(300);
    } else break;
  }
}

async function saveScreenshot(filename) {
  await cmd('bridge.screenshot');
  await sleep(500);
  try {
    const res = await fetch(`${BASE}/screenshot`);
    const d = await res.json();
    if (d.data) {
      const buf = Buffer.from(d.data, 'base64');
      const fs = await import('fs');
      fs.writeFileSync(filename, buf);
      return true;
    }
  } catch {}
  return false;
}

// Weapons to test — grouped by type
const WEAPONS = [
  // === DEFAULT WEAPONS (test first to confirm baseline) ===
  { id: 'DEFAULTS', scene: null, desc: 'GarlicAura + KnifeLauncher (built-in)', keepDefaults: true },

  // === SCENE-BASED WEAPONS (have their own .tscn, no factory needed) ===
  { id: 'GarlicAura', scene: 'res://Scenes/Weapons/GarlicAura.tscn', desc: 'AoE tick damage' },
  { id: 'WhipAttack', scene: 'res://Scenes/Weapons/WhipAttack.tscn', desc: 'Arc attack' },
  { id: 'Scythe', scene: 'res://Scenes/Weapons/Scythe.tscn', desc: 'Melee slash' },
  { id: 'SpectralSword', scene: 'res://Scenes/Weapons/SpectralSword.tscn', desc: 'Orbiting sword' },
  { id: 'EarthquakeWeapon', scene: 'res://Scenes/Weapons/EarthquakeWeapon.tscn', desc: 'Ground slam AoE' },
  { id: 'PulseCannon', scene: 'res://Scenes/Weapons/PulseCannon.tscn', desc: 'Pulse projectile' },
  { id: 'SniperBeam', scene: 'res://Scenes/Weapons/SniperBeam.tscn', desc: 'Long-range beam' },
  { id: 'SawBlade', scene: 'res://Scenes/Weapons/SawBlade.tscn', desc: 'Bouncing saw' },
  { id: 'Whirlwind', scene: 'res://Scenes/Weapons/Whirlwind.tscn', desc: 'Spinning AoE (5s cooldown, 1.2s burst)' },

  // === WEAPONS THAT SPAWN PROJECTILES (need PackedScene export) ===
  { id: 'MeteorShower', scene: 'res://Scenes/Weapons/MeteorShower.tscn', desc: 'Rains meteors' },
  { id: 'ChainBomb', scene: 'res://Scenes/Weapons/ChainBomb.tscn', desc: 'Chain bombs' },
  { id: 'Shotgun', scene: 'res://Scenes/Weapons/Shotgun.tscn', desc: 'Burst fire' },
  { id: 'SummonSkeleton', scene: 'res://Scenes/Weapons/SummonSkeleton.tscn', desc: 'Skeleton minion' },
  { id: 'LightningOrb', scene: 'res://Scenes/Weapons/LightningOrb.tscn', desc: 'Orbiting lightning' },
];

async function testWeapon(weapon) {
  // Restart game
  await cmd('scene.start_game');
  await sleep(2000);

  // Set high HP
  await cmd('player.set_max_hp', { maxHp: 99999 });
  await cmd('player.set_hp', { hp: 99999 });
  await sleep(200);

  if (!weapon.keepDefaults) {
    // Remove default weapons
    await cmd('weapons.remove', { weaponId: 'GarlicAura' });
    await cmd('weapons.remove', { weaponId: 'KnifeLauncher' });
    await sleep(200);

    // Add test weapon
    if (weapon.scene) {
      const r = await cmd('weapons.add', { weaponId: weapon.id, scenePath: weapon.scene });
      if (!r.ok) {
        return { ...weapon, status: 'FAIL_ADD', error: r.error, kills: 0 };
      }
    }
  }

  // Verify weapon is equipped
  await sleep(500);
  const s1 = await getState();
  const equippedWeapons = (s1.weapons || []).map(w => w.id);

  if (!weapon.keepDefaults && !equippedWeapons.includes(weapon.id)) {
    return { ...weapon, status: 'FAIL_EQUIP', error: `Not equipped. Have: ${equippedWeapons.join(',')}`, kills: 0 };
  }

  const killsBefore = s1.enemies?.killed ?? 0;

  // Spawn enemies close to player (they start 400-600 units away)
  await cmd('enemies.spawn', { count: 10 });

  // Wait for enemies to approach and weapon to deal damage
  // Re-spawn enemies every 8 seconds to keep targets available
  for (let i = 0; i < TEST_SECONDS; i++) {
    await sleep(1000);
    await dismissLevelUp();
    // Keep player alive
    await cmd('player.set_hp', { hp: 99999 });
    // Re-spawn every 8 seconds
    if (i > 0 && i % 8 === 0) {
      await cmd('enemies.spawn', { count: 6 });
    }
  }

  // Check results
  const s2 = await getState();
  const killsAfter = s2.enemies?.killed ?? 0;
  const newKills = killsAfter - killsBefore;
  const alive = s2.enemies?.alive ?? 0;

  // Take debug screenshot
  const screenshotFile = `/tmp/weapon_${weapon.id}.png`;
  await saveScreenshot(screenshotFile);

  return {
    ...weapon,
    status: newKills > 0 ? 'PASS' : 'NO_KILLS',
    kills: newKills,
    alive,
    equipped: equippedWeapons,
    screenshot: screenshotFile,
  };
}

async function main() {
  console.log('=== WEAPON VERIFICATION v2 ===\n');

  // Check connection
  try {
    const h = await fetch(`${BASE}/health`).then(r => r.json());
    if (!h.connected) { console.error('Game not connected!'); process.exit(1); }
  } catch { console.error('Bridge not running!'); process.exit(1); }

  const results = [];

  for (const weapon of WEAPONS) {
    const label = weapon.keepDefaults ? 'DEFAULTS' : weapon.id;
    process.stdout.write(`Testing ${label.padEnd(20)}... `);

    try {
      const result = await testWeapon(weapon);
      results.push(result);
      const status = result.status === 'PASS' ? '✓ PASS' : '✗ FAIL';
      const extra = result.error ? ` (${result.error})` : '';
      console.log(`${status} — ${result.kills} kills, ${result.alive} alive${extra}`);
    } catch (err) {
      results.push({ ...weapon, status: 'ERROR', error: err.message, kills: 0 });
      console.log(`✗ ERROR — ${err.message}`);
    }
  }

  // Summary
  console.log('\n=== RESULTS SUMMARY ===\n');
  console.log('Status    | Kills | Weapon              | Description');
  console.log('----------|-------|---------------------|------------------------------------------');

  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓ PASS  ' : `✗ ${(r.status || 'FAIL').padEnd(6)}`;
    const kills = String(r.kills).padStart(5);
    const id = (r.keepDefaults ? 'DEFAULTS' : r.id).padEnd(20);
    const extra = r.error ? ` [${r.error}]` : '';
    console.log(`${icon} |${kills} | ${id}| ${r.desc}${extra}`);
    if (r.status === 'PASS') passed++; else failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${results.length} weapons`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
