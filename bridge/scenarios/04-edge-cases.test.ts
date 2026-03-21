/**
 * Edge Cases — Test unusual player behavior and error paths.
 * Die immediately, pause spam, ESC during level-up, etc.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { BridgeClient, sleep } from '../src/bridge-client.js'
import { ARTIFACTS } from '../src/test-config.js'

describe('Edge Cases', () => {
  const bridge = new BridgeClient({ artifactsDir: ARTIFACTS })

  beforeAll(async () => {
    const ok = await bridge.waitForConnection(10)
    expect(ok).toBe(true)
  })

  describe('Instant Death', () => {
    beforeEach(async () => {
      await bridge.startGame()
    })

    it('player can be killed via damage command', async () => {
      const p = await bridge.player()
      bridge.log(`Player HP before: ${p.hp}/${p.maxHp}`)

      // Deal massive damage
      await bridge.cmd('player.damage', { amount: 9999 })
      await sleep(1500)

      await bridge.screenshot('edge_instant_death.png')

      // Game over UI should appear or player should be dead
      const afterP = await bridge.player()
      expect(afterP.hp).toBeLessThanOrEqual(0)
      bridge.log(`Player HP after: ${afterP.hp} alive=${afterP.alive}`)
    })

    it('can restart after death', async () => {
      // Kill player
      await bridge.cmd('player.damage', { amount: 9999 })
      await sleep(2000)

      // Restart
      await bridge.cmd('scene.start_game')
      await bridge.waitForGameplay(10000)

      const p = await bridge.player()
      expect(p.hp).toBeGreaterThan(0)
      expect(p.alive).toBe(true)
      bridge.log(`Restarted: HP=${p.hp}/${p.maxHp}`)
    })
  })

  describe('Pause/Unpause Spam', () => {
    beforeEach(async () => {
      await bridge.startGame()
    })

    it('survives 20 rapid pause/unpause cycles', async () => {
      for (let i = 0; i < 20; i++) {
        await bridge.cmd('bridge.pause')
        await sleep(50)
        await bridge.cmd('bridge.unpause')
        await sleep(50)
      }

      // Game should still be functional
      expect(await bridge.isConnected()).toBe(true)
      const p = await bridge.player()
      expect(p.alive).toBe(true)
      bridge.log('Survived 20 pause/unpause cycles')
    })

    it('timescale toggle stress', async () => {
      const scales = [0.5, 2, 0.1, 5, 1, 10, 0, 1]
      for (const scale of scales) {
        await bridge.cmd('bridge.set_timescale', { scale })
        await sleep(200)
      }

      // Reset to normal
      await bridge.cmd('bridge.set_timescale', { scale: 1 })
      expect(await bridge.isConnected()).toBe(true)
      bridge.log('Timescale stress test passed')
    })
  })

  describe('Level-Up Interruption', () => {
    beforeEach(async () => {
      await bridge.startGame()
      await bridge.cmd('player.set_invincible', { enabled: true })
    })

    it('level-up menu survives if enemies spawn during it', async () => {
      // Trigger level-up
      const appeared = await bridge.addXpAndLevelUp(500)

      if (appeared) {
        // Spawn enemies while menu is open
        await bridge.spawnEnemies(20)
        await sleep(1000)

        // Menu should still be visible
        const opts = await bridge.cmd('ui.levelup_options')
        const value = opts.value as { visible: boolean }
        expect(value.visible).toBe(true)

        // Choose an option
        await bridge.chooseLevelUp(1)
        bridge.log('Level-up survived enemy spawn interruption')
      }

      await bridge.cmd('player.set_invincible', { enabled: false })
    })
  })

  describe('Invalid Commands', () => {
    it('handles unknown command gracefully', async () => {
      const result = await bridge.cmd('nonexistent.command' as any)
      expect(result.ok).toBe(false)
      bridge.log(`Unknown command response: ${result.error}`)
    })

    it('handles missing args gracefully', async () => {
      // Heal without amount
      const result = await bridge.cmd('player.heal')
      // Should either fail gracefully or use default
      bridge.log(`Missing args response: ok=${result.ok} error=${result.error}`)
    })

    it('handles negative values', async () => {
      const result = await bridge.cmd('player.heal', { amount: -100 })
      bridge.log(`Negative heal response: ok=${result.ok} value=${JSON.stringify(result.value)}`)
      // Should not crash
      expect(await bridge.isConnected()).toBe(true)
    })
  })

  describe('Rapid Scene Changes', () => {
    it('survives 5 rapid start/title cycles', async () => {
      for (let i = 0; i < 5; i++) {
        await bridge.cmd('scene.start_game')
        await sleep(2000)
        await bridge.cmd('scene.title')
        await sleep(1000)
      }

      expect(await bridge.isConnected()).toBe(true)
      bridge.log('Survived 5 scene change cycles')
      await bridge.screenshot('edge_scene_spam.png')
    })
  })

  it('final cleanup', async () => {
    await bridge.snapshot('edge_cases_final')
    await bridge.screenshot('edge_final.png')
  })
})
