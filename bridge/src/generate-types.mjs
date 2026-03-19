#!/usr/bin/env node
/**
 * Generate C# types from the bridge protocol schema.
 * Keeps Godot C# and Vitest TS types in sync via single source of truth.
 *
 * Usage: node src/generate-types.mjs
 *
 * Output: src/generated/BridgeProtocol.cs → copy to Godot project if needed
 */

import {
  quicktype,
  InputData,
  jsonInputForTargetLanguage,
} from 'quicktype-core'

const PROTOCOL_SAMPLES = {
  CommandMessage: JSON.stringify({
    type: 'cmd',
    id: 'test_001',
    cmd: 'player.heal',
    args: { amount: 50 },
  }),
  AckMessage: JSON.stringify({
    type: 'ack',
    id: 'test_001',
    ok: true,
    value: { hp: 100, maxHp: 100 },
    error: null,
  }),
  StateMessage: JSON.stringify({
    type: 'state',
    player: {
      hp: 80,
      maxHp: 100,
      level: 3,
      xp: 150,
      xpToNext: 300,
      position: { x: 100.5, y: -200.3 },
      speed: 200,
      alive: true,
    },
    weapons: [
      { id: 'knife', name: 'Knife', level: 2, damage: 15, cooldown: 0.8 },
    ],
    passives: [
      { id: 'IronSkinPassive', name: 'Iron Skin', level: 1 },
    ],
    enemies: { alive: 12, killed: 47, totalSpawned: 59 },
    wave: { currentWave: 3, spawnInterval: 1.5, difficulty: 2.0, maxEnemies: 30 },
    bridge: {
      broadcastRate: 2,
      screenshotInterval: 1.0,
      screenshotEnabled: true,
      timescale: 1.0,
      paused: false,
    },
  }),
  EventMessage: JSON.stringify({
    type: 'event',
    event: 'health_changed',
    data: { hp: 80, maxHp: 100, delta: -10 },
    _eventId: 42,
  }),
  ScreenshotMessage: JSON.stringify({
    type: 'screenshot',
    payload: {
      width: 1152,
      height: 648,
      format: 'png',
      data: 'base64...',
    },
  }),
}

async function generate() {
  const jsonInput = jsonInputForTargetLanguage('csharp')

  for (const [name, sample] of Object.entries(PROTOCOL_SAMPLES)) {
    await jsonInput.addSource({ name, samples: [sample] })
  }

  const inputData = new InputData()
  inputData.addInput(jsonInput)

  const result = await quicktype({
    inputData,
    lang: 'csharp',
    rendererOptions: {
      namespace: 'BridgeProtocol',
      'csharp-version': '6',
      'any-type': 'object',
      'number-type': 'double',
      features: 'attributes-only',
      'check-required': 'true',
    },
  })

  const code = result.lines.join('\n')

  // Write to generated directory
  const { writeFileSync, mkdirSync } = await import('fs')
  const { join, dirname } = await import('path')
  const { fileURLToPath } = await import('url')

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const outDir = join(__dirname, 'generated')
  mkdirSync(outDir, { recursive: true })

  const outPath = join(outDir, 'BridgeProtocol.cs')
  writeFileSync(outPath, code)
  console.log(`Generated: ${outPath}`)
  console.log(`Types: ${Object.keys(PROTOCOL_SAMPLES).join(', ')}`)
}

generate().catch(e => {
  console.error('Generation failed:', e)
  process.exit(1)
})
