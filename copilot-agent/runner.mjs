#!/usr/bin/env node
/**
 * Deterministic Playtest Runner — zero LLM calls.
 * Executes a fixed play loop via bridge HTTP API, produces structured artifacts.
 * Used by the meta-loop as the subprocess instead of Copilot SDK.
 *
 * Usage: node runner.mjs --duration 120 --output ./output/iter-0
 */

import { writeFileSync, mkdirSync, appendFileSync, readFileSync } from 'fs'
import { join } from 'path'

const BASE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:9901'
const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def
}
const DURATION = parseInt(getArg('--duration', '120'))
const OUTPUT = getArg('--output', './output')
const PROMPT_FILE = getArg('--prompt', '')

mkdirSync(OUTPUT, { recursive: true })
mkdirSync(join(OUTPUT, 'bugs'), { recursive: true })
mkdirSync(join(OUTPUT, 'diffs'), { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── HTTP helpers ─────────────────────────────────────────────
async function httpGet(path) {
  const resp = await fetch(`${BASE_URL}${path}`)
  return resp.json()
}

async function httpCmd(cmd, cmdArgs) {
  const body = { cmd }
  if (cmdArgs) body.args = cmdArgs
  const resp = await fetch(`${BASE_URL}/cmd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return resp.json()
}

// ── Logging ──────────────────────────────────────────────────
const logPath = join(OUTPUT, 'session.jsonl')
function log(level, message, system, state) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    system: system || null,
    state: state ? JSON.stringify(state) : null,
  }
  appendFileSync(logPath, JSON.stringify(entry) + '\n')
  console.log(`  [${level}] ${message}`)
}

function fileBug(title, severity, system, reproSteps, actual, expected, codeLocation, rootCause) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
  const bug = { title, severity, system, reproSteps, actual, expected, codeLocation, rootCause, timestamp: new Date().toISOString(), agent: 'deterministic-runner' }
  writeFileSync(join(OUTPUT, 'bugs', `${slug}.json`), JSON.stringify(bug, null, 2))
}

// ── Screenshot ───────────────────────────────────────────────
let ssCount = 0
async function screenshot(label) {
  await httpCmd('bridge.screenshot')
  await sleep(1500)
  try {
    const resp = await fetch(`${BASE_URL}/screenshot.png`)
    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length > 100) {
      const name = `screenshot_${++ssCount}.png`
      writeFileSync(join(OUTPUT, name), buf)
      return name
    }
  } catch {}
  return null
}

// ── Movement patterns ────────────────────────────────────────
const MOVES = [
  { x: 1, y: 0 },      // right
  { x: 0.7, y: -0.7 },  // up-right
  { x: 0, y: -1 },      // up
  { x: -0.7, y: -0.7 }, // up-left
  { x: -1, y: 0 },      // left
  { x: -0.7, y: 0.7 },  // down-left
  { x: 0, y: 1 },       // down
  { x: 0.7, y: 0.7 },   // down-right
]

// ══════════════════════════════════════════════════════════════
//  MAIN LOOP
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log(`[runner] Deterministic playtest: ${DURATION}s → ${OUTPUT}`)

  // Wait for connection
  for (let i = 0; i < 15; i++) {
    try {
      const h = await httpGet('/health')
      if (h.connected) { console.log('[runner] Bridge connected'); break }
    } catch {}
    if (i === 14) { console.error('[runner] Bridge not connected'); process.exit(1) }
    await sleep(1000)
  }

  // Reset to title screen (in case previous iteration left us in gameplay)
  console.log('[runner] Resetting to title screen...')
  try { await httpCmd('scene.title') } catch {}
  await sleep(2000)

  // Start fresh game via menu flow
  console.log('[runner] Starting game...')
  await httpCmd('ui.click_by_text', { text: 'Classic' }); await sleep(2000)
  await httpCmd('ui.click_by_text', { text: 'Start Run' }); await sleep(2000)
  await httpCmd('ui.click_by_text', { text: 'Normal' }); await sleep(2000)
  await httpCmd('ui.click_by_text', { text: 'Start Run' }); await sleep(3000)

  await httpCmd('player.set_invincible', { enabled: true })
  await httpCmd('player.heal', { amount: 9999 })
  await httpCmd('bridge.set_timescale', { scale: 3 })
  log('info', 'Game started: invincible=true, timescale=3x', 'setup')
  await screenshot('start')

  // Play loop
  const startTime = Date.now()
  let turn = 0
  const maxTurns = 15
  let prevKills = 0
  let prevXp = 0
  let prevLevel = 1

  while ((Date.now() - startTime) / 1000 < DURATION && turn < maxTurns) {
    turn++
    const remaining = DURATION - Math.floor((Date.now() - startTime) / 1000)
    if (remaining <= 0) break

    // 1. Observe state
    let state
    try { state = await httpGet('/state') } catch { continue }
    const p = state.player || {}
    const e = state.enemies || {}
    const w = state.weapons || []
    const wave = state.wave || {}

    // 2. Move
    const dir = MOVES[(turn - 1) % MOVES.length]
    await httpCmd('input.move', dir)

    // 3. Check level-up
    try {
      const opts = await httpCmd('ui.levelup_options')
      const val = opts.value
      if (val && val.visible && val.options && val.options.length > 0) {
        const choice = Math.floor(Math.random() * val.options.length) + 1
        await httpCmd('ui.levelup_choose', { option: choice })
        log('info', `Level-up: chose option ${choice}`, 'progression')
      }
    } catch {}

    // 4. Log observations
    const stateSnapshot = { hp: p.hp, maxHp: p.maxHp, level: p.level, xp: p.xp, kills: e.killed, alive: e.alive, ecsAlive: e.ecsAlive, wave: wave.currentWave }

    // Check for issues
    if (p.hp <= 0 && turn > 1) {
      log('error', `Player HP=0 despite invincibility (turn ${turn})`, 'player', stateSnapshot)
      await httpCmd('player.set_invincible', { enabled: true })
      await httpCmd('player.heal', { amount: 9999 })
    }

    if (e.killed > prevKills + 5 && p.xp === prevXp && p.xp === 0) {
      log('warn', `Kills increasing (${e.killed}) but XP stuck at ${p.xp}`, 'progression', stateSnapshot)
    }

    if (e.alive > (e.maxEnemies || 20) + 5) {
      log('warn', `Enemy count ${e.alive} exceeds max ${e.maxEnemies || 20}`, 'enemies', stateSnapshot)
    }

    if (wave.currentWave === 0 && e.killed > 10) {
      log('warn', `Wave still 0 after ${e.killed} kills`, 'enemies', stateSnapshot)
    }

    log('observation', `Turn ${turn}: HP=${p.hp}/${p.maxHp} Lv=${p.level} XP=${p.xp} Kills=${e.killed} Alive=${e.alive} Wave=${wave.currentWave}`, 'player', stateSnapshot)

    prevKills = e.killed || 0
    prevXp = p.xp || 0
    prevLevel = p.level || 1

    // 5. Periodic actions
    if (turn % 3 === 0) await screenshot(`turn_${turn}`)
    if (turn % 5 === 0) await httpCmd('enemies.spawn', { count: 10 })

    // 6. Get events
    try {
      const events = await httpGet('/events?last=10')
      const types = events.map(e => e.event).filter(Boolean)
      const unique = [...new Set(types)]
      if (unique.length > 0) log('info', `Events: ${unique.join(', ')}`, 'events')
    } catch {}

    await sleep(3000)
  }

  // Final state
  let finalState
  try { finalState = await httpGet('/state') } catch { finalState = {} }
  await screenshot('final')
  log('info', `Session complete: ${turn} turns`, 'summary', finalState)

  // Auto-detect bugs from observations
  const fp = finalState.player || {}
  const fe = finalState.enemies || {}

  if (fp.xp === 0 && fe.killed > 5) {
    fileBug('XP not increasing despite kills', 'major', 'progression',
      '1. Start game\\n2. Kill enemies\\n3. Check XP value',
      `XP stays at 0 after ${fe.killed} kills`,
      'XP should increase as enemies are killed and gems collected',
      'Scripts/Player/PlayerLevel.cs', 'Enemies may not drop XP gems or gems not collected')
  }

  if (fp.level === 1 && fe.killed > 20) {
    fileBug('Player stuck at level 1', 'major', 'progression',
      '1. Play for 60+ seconds\\n2. Kill 20+ enemies\\n3. Check player level',
      `Still level 1 after ${fe.killed} kills`,
      'Player should level up after collecting enough XP',
      'Scripts/Enemies/EnemyBase.cs', 'XP gem drop or collection may be broken')
  }

  // Write report
  const report = [
    `# Playtest Report - ${new Date().toISOString()}`,
    '',
    '## Session Config',
    `- Duration: ${DURATION}s`,
    `- Runner: deterministic (zero LLM calls)`,
    `- Turns: ${turn}`,
    '',
    '## Final Stats',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Level | ${fp.level || '?'} |`,
    `| HP | ${fp.hp || '?'}/${fp.maxHp || '?'} |`,
    `| Enemies Killed | ${fe.killed || 0} |`,
    `| Weapons | ${(finalState.weapons || []).map(w => `${w.id}(lv${w.level})`).join(', ') || 'none'} |`,
    `| Passives | ${(finalState.passives || []).map(p => `${p.id}(lv${p.level})`).join(', ') || 'none'} |`,
    '',
  ].join('\n')
  writeFileSync(join(OUTPUT, 'report.md'), report)

  console.log(`[runner] Done. ${turn} turns, ${fe.killed || 0} kills.`)
}

main().catch(e => { console.error(e); process.exit(1) })
