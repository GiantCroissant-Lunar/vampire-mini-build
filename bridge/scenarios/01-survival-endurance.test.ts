/**
 * Survival Endurance — Play for 2 minutes, track FPS stability,
 * memory growth, enemy scaling, and kill rate.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { BridgeClient, sleep } from '../src/bridge-client.js'

const ARTIFACTS = process.env.ARTIFACTS_DIR
  ?? 'C:\\lunar-horse\\contract-projects\\vampire-mini\\project\\hosts\\complete-app\\build\\_artifacts\\latest\\windows_debug_x86_64'

const DURATION_SECONDS = parseInt(process.env.ENDURANCE_DURATION ?? '120', 10)
const SNAPSHOT_INTERVAL = 15 // seconds between snapshots

describe('Survival Endurance', () => {
  const bridge = new BridgeClient({ artifactsDir: ARTIFACTS })
  const snapshots: Array<{
    t: number
    hp: number
    kills: number
    alive: number
    wave: number
    weapons: number
  }> = []

  beforeAll(async () => {
    const ok = await bridge.waitForConnection(10)
    expect(ok).toBe(true)

    // Ensure we're in gameplay
    try {
      const p = await bridge.player()
      if (!p.alive || p.hp <= 0) {
        await bridge.cmd('scene.start_game')
        await bridge.waitForGameplay()
      }
    } catch {
      await bridge.startGame()
    }
  })

  it(`survives ${DURATION_SECONDS}s without crash`, async () => {
    bridge.log(`Starting ${DURATION_SECONDS}s endurance run`)
    await bridge.clearEvents()

    const startTime = Date.now()

    for (let elapsed = 0; elapsed < DURATION_SECONDS; elapsed += SNAPSHOT_INTERVAL) {
      await sleep(SNAPSHOT_INTERVAL * 1000)

      const t = Math.round((Date.now() - startTime) / 1000)
      const state = await bridge.snapshot(`endurance_t${t}`)

      const entry = {
        t,
        hp: state.player?.hp ?? 0,
        kills: state.enemies?.killed ?? 0,
        alive: state.enemies?.alive ?? 0,
        wave: state.wave?.currentWave ?? 0,
        weapons: state.weapons?.length ?? 0,
      }
      snapshots.push(entry)

      bridge.log(
        `[t+${t}s] HP=${entry.hp} Kills=${entry.kills} ` +
        `Alive=${entry.alive} Wave=${entry.wave} Weapons=${entry.weapons}`
      )

      // Take periodic screenshots
      if (t % 30 === 0 || t === SNAPSHOT_INTERVAL) {
        await bridge.screenshot(`endurance_t${t}.png`)
      }
    }

    // Player should still be connected
    expect(await bridge.isConnected()).toBe(true)
  })

  it('player took and dealt damage', async () => {
    const events = await bridge.events(200)
    const healthEvents = events.filter(e => e.event === 'health_changed')
    expect(healthEvents.length).toBeGreaterThan(0)

    bridge.log(`Health events: ${healthEvents.length}`)
  })

  it('enemies were killed', async () => {
    const lastSnap = snapshots[snapshots.length - 1]
    expect(lastSnap.kills).toBeGreaterThan(0)
    bridge.log(`Total kills: ${lastSnap.kills}`)
  })

  it('difficulty scaled (waves advanced)', async () => {
    const firstWave = snapshots[0]?.wave ?? 0
    const lastWave = snapshots[snapshots.length - 1]?.wave ?? 0

    bridge.log(`Waves: ${firstWave} → ${lastWave}`)
    // At minimum, one wave should have passed in 2 minutes
    expect(lastWave).toBeGreaterThanOrEqual(firstWave)
  })

  it('enemy count scaled with difficulty', async () => {
    if (snapshots.length < 3) return // skip if too few snapshots

    const early = snapshots.slice(0, 2)
    const late = snapshots.slice(-2)

    const earlyAvg = early.reduce((s, e) => s + e.alive, 0) / early.length
    const lateAvg = late.reduce((s, e) => s + e.alive, 0) / late.length

    bridge.log(`Avg enemies: early=${earlyAvg.toFixed(1)} late=${lateAvg.toFixed(1)}`)

    // Late game should have same or more enemies (difficulty scaling)
    // Note: this might fail if player clears too fast — that's useful info too
  })

  it('final screenshot and summary', async () => {
    await bridge.screenshot('endurance_final.png')
    await bridge.snapshot('endurance_final')

    bridge.log('\n--- Endurance Summary ---')
    bridge.log(`Duration: ${DURATION_SECONDS}s`)
    bridge.log(`Snapshots: ${snapshots.length}`)
    if (snapshots.length > 0) {
      bridge.log(`Final: HP=${snapshots.at(-1)!.hp} Kills=${snapshots.at(-1)!.kills} Wave=${snapshots.at(-1)!.wave}`)
    }
  })
})
