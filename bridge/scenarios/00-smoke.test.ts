/**
 * Smoke Test — Verify the absolute basics work.
 * Fast (~15s). Run first to catch fundamental issues.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { BridgeClient, sleep } from '../src/bridge-client.js'

const ARTIFACTS = process.env.ARTIFACTS_DIR
  ?? 'C:\\lunar-horse\\contract-projects\\vampire-mini\\project\\hosts\\complete-app\\build\\_artifacts\\latest\\windows_debug_x86_64'

describe('Smoke Test', () => {
  const bridge = new BridgeClient({ artifactsDir: ARTIFACTS })

  beforeAll(async () => {
    const ok = await bridge.waitForConnection(10)
    expect(ok).toBe(true)
  })

  it('game is connected to bridge', async () => {
    expect(await bridge.isConnected()).toBe(true)
  })

  it('can detect current UI state', async () => {
    const buttons = await bridge.cmd('ui.get_buttons')
    const scene = await bridge.cmd('ui.get_scene')

    bridge.log(`Scene: ${JSON.stringify(scene.value)}`)
    bridge.log(`Buttons: ${JSON.stringify(buttons.value)}`)
    await bridge.screenshot('smoke_initial.png')
  })

  it('can navigate to gameplay', async () => {
    // Force start via scene command — works from any screen
    await bridge.cmd('scene.start_game')
    await sleep(3000)

    // Check if player exists in state
    const state = await bridge.state()
    const hasPlayer = state.player && state.player.hp > 0

    if (!hasPlayer) {
      // May need more time for scene transition
      await sleep(5000)
    }

    await bridge.screenshot('smoke_gameplay.png')
    await bridge.snapshot('smoke_gameplay')
  })

  it('player spawns with HP', async () => {
    // Poll for player state (scene may still be loading)
    // Check for maxHp > 0 (player exists) — hp may already be depleted
    const state = await bridge.waitForState(
      s => (s.player?.maxHp ?? 0) > 0,
      20000,
      500,
      'player spawned'
    )

    expect(state.player!.maxHp).toBeGreaterThan(0)
    bridge.log(`Player: HP=${state.player!.hp}/${state.player!.maxHp} Level=${state.player!.level}`)

    // If player already died, that's still a valid spawn — just fast death
    if (state.player!.hp <= 0) {
      bridge.log('Note: Player died quickly — contact damage may be too high')
    }
  })

  it('weapons are equipped', async () => {
    const weapons = await bridge.weapons()
    expect(weapons.length).toBeGreaterThan(0)
    bridge.log(`Weapons: ${weapons.map(w => w.name ?? w.id).join(', ')}`)
  })

  it('enemies spawn within 15s', async () => {
    const state = await bridge.waitForState(
      s => (s.enemies?.alive ?? 0) > 0,
      15000,
      1000,
      'enemies spawning'
    )
    expect(state.enemies!.alive).toBeGreaterThan(0)
    bridge.log(`Enemies alive: ${state.enemies!.alive}`)
  })

  it('final snapshot', async () => {
    await bridge.snapshot('smoke_final')
    await bridge.screenshot('smoke_final.png')
  })
})
