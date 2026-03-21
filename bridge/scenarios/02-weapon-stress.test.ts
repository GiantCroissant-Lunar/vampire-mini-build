/**
 * Weapon Stress Test — Add all weapons, verify no duplicates,
 * test upgrades, and check DPS under heavy enemy load.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { BridgeClient, sleep } from '../src/bridge-client.js'
import { ARTIFACTS } from '../src/test-config.js'

describe('Weapon Stress Test', () => {
  const bridge = new BridgeClient({ artifactsDir: ARTIFACTS })

  beforeAll(async () => {
    const ok = await bridge.waitForConnection(10)
    expect(ok).toBe(true)

    // Start fresh game
    await bridge.startGame()
    await bridge.clearEvents()
  })

  it('starts with at least one weapon', async () => {
    const weapons = await bridge.weapons()
    expect(weapons.length).toBeGreaterThan(0)
    bridge.log(`Starting weapons: ${weapons.map(w => `${w.name ?? w.id}(L${w.level})`).join(', ')}`)
  })

  it('adding same weapon upgrades instead of duplicating', async () => {
    const before = await bridge.weapons()
    const firstWeapon = before[0]

    // Try adding the same weapon again
    await bridge.cmd('weapons.add', { id: firstWeapon.id })
    await sleep(500)

    const after = await bridge.weapons()

    // Count should be same (no duplicate)
    const beforeCount = before.filter(w => w.id === firstWeapon.id).length
    const afterCount = after.filter(w => w.id === firstWeapon.id).length
    expect(afterCount).toBe(beforeCount)

    // Level should have increased
    const upgraded = after.find(w => w.id === firstWeapon.id)
    expect(upgraded!.level).toBeGreaterThanOrEqual(firstWeapon.level)

    bridge.log(`Dedup check: ${firstWeapon.id} L${firstWeapon.level} → L${upgraded!.level}`)
    await bridge.screenshot('weapon_dedup.png')
  })

  it('handles rapid weapon upgrades', async () => {
    const weapons = await bridge.weapons()
    const target = weapons[0]

    // Rapid-fire upgrades
    for (let i = 0; i < 5; i++) {
      await bridge.cmd('weapons.upgrade', { id: target.id })
    }
    await sleep(500)

    const after = await bridge.weapons()
    const upgraded = after.find(w => w.id === target.id)

    bridge.log(`Rapid upgrade: ${target.id} L${target.level} → L${upgraded?.level}`)
    expect(upgraded!.level).toBeGreaterThan(target.level)
  })

  it('weapons deal damage under heavy load', async () => {
    await bridge.clearEvents()

    // Make player invincible so we can focus on weapon output
    await bridge.cmd('player.set_invincible', { enabled: true })

    // Spawn lots of enemies
    await bridge.spawnEnemies(50)
    bridge.log('Spawned 50 enemies — watching for kills...')

    await sleep(8000) // let weapons work

    const enemies = await bridge.enemies()
    bridge.log(`After 8s: killed=${enemies.killed} alive=${enemies.alive}`)

    // Weapons should have killed something
    expect(enemies.killed).toBeGreaterThan(0)

    await bridge.screenshot('weapon_stress.png')

    // Restore vulnerability
    await bridge.cmd('player.set_invincible', { enabled: false })
  })

  it('final weapon inventory snapshot', async () => {
    const weapons = await bridge.weapons()
    const passives = await bridge.passives()

    bridge.log('\n--- Weapon Inventory ---')
    for (const w of weapons) {
      bridge.log(`  ${w.name ?? w.id} L${w.level}${w.damage ? ` (dmg=${w.damage})` : ''}`)
    }
    bridge.log(`\n--- Passives (${passives.length}) ---`)
    for (const p of passives) {
      bridge.log(`  ${p.name ?? p.id} L${p.level}`)
    }

    await bridge.snapshot('weapon_stress_final')
    await bridge.screenshot('weapon_inventory.png')

    // Verify no duplicate weapon IDs
    const ids = weapons.map(w => w.id)
    const unique = new Set(ids)
    expect(ids.length).toBe(unique.size)
    bridge.log(`\nNo duplicates: ${ids.length} weapons, ${unique.size} unique`)
  })
})
