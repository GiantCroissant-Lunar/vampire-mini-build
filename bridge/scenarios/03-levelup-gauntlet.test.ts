/**
 * Level-Up Gauntlet — Rapid XP injection to cycle through
 * all level-up choices and verify the upgrade flow.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { BridgeClient, sleep } from '../src/bridge-client.js'
import { ARTIFACTS } from '../src/test-config.js'

describe('Level-Up Gauntlet', () => {
  const bridge = new BridgeClient({ artifactsDir: ARTIFACTS })
  const levelHistory: Array<{
    level: number
    options: string[]
    chosen: string
  }> = []

  beforeAll(async () => {
    const ok = await bridge.waitForConnection(10)
    expect(ok).toBe(true)

    // Start fresh
    await bridge.startGame()

    // Make invincible so we don't die mid-gauntlet
    await bridge.cmd('player.set_invincible', { enabled: true })
    await bridge.clearEvents()
  })

  it('initial level is 1', async () => {
    const p = await bridge.player()
    expect(p.level).toBe(1)
  })

  it('can trigger level-up via XP injection', async () => {
    const appeared = await bridge.addXpAndLevelUp(500)
    expect(appeared).toBe(true)

    await bridge.screenshot('levelup_first.png')
  })

  it('level-up menu shows options', async () => {
    const opts = await bridge.cmd('ui.levelup_options')
    const value = opts.value as { visible: boolean; options?: Array<{ text: string }> }

    expect(value.visible).toBe(true)
    expect(value.options).toBeDefined()
    expect(value.options!.length).toBeGreaterThan(0)

    const texts = value.options!.map(o => o.text)
    bridge.log(`Level-up options: ${texts.join(', ')}`)
  })

  it('can choose option and game resumes', async () => {
    // Choose first option
    const result = await bridge.cmd('ui.levelup_choose', { option: 1 })
    expect(result.ok).toBe(true)

    await sleep(1000)

    // Menu should be gone
    const opts = await bridge.cmd('ui.levelup_options')
    const value = opts.value as { visible: boolean }
    expect(value.visible).toBe(false)
  })

  it('rapid level-up cycle (10 levels)', async () => {
    bridge.log('\n--- Rapid Level-Up Cycle ---')

    for (let i = 0; i < 10; i++) {
      const beforeP = await bridge.player()

      // Inject XP
      await bridge.cmd('player.add_xp', { amount: 500 })
      await sleep(800)

      // Check if menu appeared
      const opts = await bridge.cmd('ui.levelup_options')
      const value = opts.value as { visible: boolean; options?: Array<{ text: string }> }

      if (value.visible && value.options && value.options.length > 0) {
        const texts = value.options.map(o => o.text)

        // Alternate between options to test variety
        const choice = (i % Math.min(3, texts.length)) + 1
        const chosenText = texts[choice - 1] ?? texts[0]

        await bridge.cmd('ui.levelup_choose', { option: choice })
        await sleep(500)

        const afterP = await bridge.player()

        levelHistory.push({
          level: afterP.level,
          options: texts,
          chosen: chosenText,
        })

        bridge.log(`  Level ${beforeP.level}→${afterP.level}: chose "${chosenText}" from [${texts.join(', ')}]`)

        // Screenshot every 3rd level-up
        if (i % 3 === 0) {
          await bridge.screenshot(`levelup_cycle_${i}.png`)
        }
      } else {
        bridge.log(`  [${i}] No level-up menu appeared (may need more XP or at level cap)`)
      }
    }

    bridge.log(`\nCompleted ${levelHistory.length} level-ups`)
  })

  it('level increased from cycling', async () => {
    const p = await bridge.player()
    bridge.log(`Final level: ${p.level}`)
    expect(p.level).toBeGreaterThan(1)
  })

  it('no double-click / duplicate upgrades during rapid cycling', async () => {
    const events = await bridge.events(200)
    const levelEvents = events.filter(e => e.event === 'level_up')

    // Each level-up event should have a unique level number
    const levels = levelEvents.map(e => (e.data as { level?: number })?.level).filter(Boolean)
    const uniqueLevels = new Set(levels)

    bridge.log(`Level-up events: ${levels.join(', ')}`)
    bridge.log(`Unique levels: ${uniqueLevels.size} / ${levels.length}`)

    // No duplicate level numbers (would indicate double-click bug)
    expect(levels.length).toBe(uniqueLevels.size)
  })

  it('final summary', async () => {
    await bridge.snapshot('levelup_gauntlet_final')
    await bridge.screenshot('levelup_final.png')

    // Restore vulnerability
    await bridge.cmd('player.set_invincible', { enabled: false })

    bridge.log('\n--- Gauntlet Summary ---')
    bridge.log(`Levels gained: ${levelHistory.length}`)
    for (const h of levelHistory) {
      bridge.log(`  L${h.level}: "${h.chosen}"`)
    }
  })
})
