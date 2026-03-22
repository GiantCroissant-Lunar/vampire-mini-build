#!/usr/bin/env node
/**
 * Deterministic Playtest Runner — zero LLM calls.
 * Executes a fixed play loop via bridge HTTP API, produces structured artifacts.
 * Used by the meta-loop as the subprocess instead of Copilot SDK.
 *
 * Usage: node runner.mjs --duration 120 --output ./output/iter-0
 */

import { writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'

const BASE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:9901'
const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def
}
const DURATION = parseInt(getArg('--duration', '120'))
const OUTPUT = getArg('--output', './output')

mkdirSync(OUTPUT, { recursive: true })
mkdirSync(join(OUTPUT, 'bugs'), { recursive: true })
mkdirSync(join(OUTPUT, 'diffs'), { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── HTTP helpers ─────────────────────────────────────────────
async function httpGet(path) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3000)
  try {
    const resp = await fetch(`${BASE_URL}${path}`, { signal: ctrl.signal })
    return resp.json()
  } finally { clearTimeout(timer) }
}

async function httpCmd(cmd, cmdArgs) {
  const body = { cmd }
  if (cmdArgs) body.args = cmdArgs
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3000)
  try {
    const resp = await fetch(`${BASE_URL}/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    return resp.json()
  } finally { clearTimeout(timer) }
}

// ── State reading with retry ─────────────────────────────────
function isValidState(state) {
  return state && state.player && typeof state.player.hp === 'number'
}

async function getStateRetry(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const state = await httpGet('/state')
      if (isValidState(state)) return state
    } catch {}
    await sleep(500)
  }
  return null
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
  try {
    await httpCmd('bridge.screenshot')
    await sleep(1000)
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

  // Reset to title screen then navigate menus
  console.log('[runner] Resetting to title screen...')
  try { await httpCmd('scene.title') } catch {}
  await sleep(4000)

  // Navigate: Classic → Normal difficulty (retry each click until it succeeds)
  console.log('[runner] Starting game via menu flow...')
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await httpCmd('ui.click_by_text', { text: 'Classic' })
      if (r?.value?.clicked) { console.log('[runner] Clicked Classic'); break }
    } catch {}
    await sleep(2000)
  }
  await sleep(3000)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await httpCmd('ui.click_by_text', { text: 'Normal' })
      if (r?.value?.clicked) { console.log('[runner] Clicked Normal'); break }
    } catch {}
    await sleep(2000)
  }
  await sleep(5000)

  // Wait for gameplay to actually start — retry until valid state
  console.log('[runner] Waiting for gameplay...')
  let gameReady = false
  for (let i = 0; i < 20; i++) {
    const s = await getStateRetry(2)
    if (s && s.player && typeof s.player.hp === 'number') { gameReady = true; break }
    // While waiting, try clicking Normal in case difficulty screen appeared
    if (i === 5 || i === 10) {
      try { await httpCmd('ui.click_by_text', { text: 'Normal' }) } catch {}
    }
    await sleep(1000)
  }
  if (!gameReady) {
    // Fallback: try scene.start_game directly (goes to Main.tscn → DifficultySelectScreen)
    console.log('[runner] Menu flow failed, trying scene.start_game...')
    try { await httpCmd('scene.start_game') } catch {}
    await sleep(4000)
    // Click Normal on the difficulty screen
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await httpCmd('ui.click_by_text', { text: 'Normal' })
        if (r?.value?.clicked) { console.log('[runner] Clicked Normal (fallback)'); break }
      } catch {}
      await sleep(2000)
    }
    await sleep(5000)
    for (let i = 0; i < 10; i++) {
      const s = await getStateRetry(2)
      if (s && s.player && typeof s.player.hp === 'number') { gameReady = true; break }
      await sleep(1000)
    }
  }
  if (!gameReady) {
    console.error('[runner] Gameplay never started after all attempts')
    log('error', 'Gameplay never started', 'setup')
    process.exit(1)
  }

  await httpCmd('player.set_invincible', { enabled: true })
  await httpCmd('player.heal', { amount: 9999 })
  await httpCmd('bridge.set_timescale', { scale: 3 })
  log('info', 'Game started: invincible=true, timescale=3x', 'setup')
  await screenshot('start')

  // Play loop
  const startTime = Date.now()
  let turn = 0
  const maxTurns = 30  // More turns for 120s
  let prevKills = 0
  let prevXp = 0
  let prevLevel = 1
  let lastGoodState = null
  let invalidStateStreak = 0
  let totalValidTurns = 0

  while ((Date.now() - startTime) / 1000 < DURATION && turn < maxTurns) {
    turn++
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    if (elapsed >= DURATION) break

    // 1. Observe state with retry
    const state = await getStateRetry(3)
    if (!state || !isValidState(state)) {
      invalidStateStreak++
      if (invalidStateStreak >= 3) {
        log('warn', `${invalidStateStreak} consecutive invalid state reads (turn ${turn})`, 'bridge')
      }
      await sleep(2000)
      continue
    }
    invalidStateStreak = 0
    totalValidTurns++
    lastGoodState = state

    const p = state.player
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
        await sleep(500) // Let state settle after level-up
      }
    } catch {}

    // 4. Build snapshot
    const stateSnapshot = {
      hp: p.hp, maxHp: p.maxHp, level: p.level, xp: p.xp,
      kills: e.killed, alive: e.alive, ecsAlive: e.ecsAlive,
      wave: wave.currentWave, weapons: w.length,
    }

    // 5. Bug detection checks
    if (p.hp <= 0 && turn > 1) {
      log('error', `Player HP=0 despite invincibility (turn ${turn})`, 'player', stateSnapshot)
      fileBug('Player dies despite invincibility', 'critical', 'player',
        '1. Enable invincibility\\n2. Play normally\\n3. Observe HP drops to 0',
        `HP=${p.hp} at turn ${turn}`, 'HP should stay above 0 with invincibility',
        'Scripts/Player/PlayerHealth.cs', 'Invincibility flag not checked in damage path')
      await httpCmd('player.set_invincible', { enabled: true })
      await httpCmd('player.heal', { amount: 9999 })
    }

    if ((e.killed || 0) > prevKills + 5 && p.xp === prevXp && p.xp === 0 && totalValidTurns > 3) {
      log('warn', `Kills increasing (${e.killed}) but XP stuck at ${p.xp}`, 'progression', stateSnapshot)
    }

    const maxCap = (e.maxEnemies || 20) + (e.ecsMaxEnemies || 20)
    const totalAlive = (e.alive || 0) + (e.ecsAlive || 0)
    if (totalAlive > maxCap + 5) {
      log('warn', `Total enemy count ${totalAlive} exceeds combined cap ${maxCap}`, 'enemies', stateSnapshot)
    }

    if (wave.currentWave === 0 && (e.killed || 0) > 15) {
      log('warn', `Wave still 0 after ${e.killed} kills`, 'enemies', stateSnapshot)
    }

    // Weapon count check — should have at least 1 weapon
    if (w.length === 0 && totalValidTurns > 3) {
      log('warn', `No weapons equipped at turn ${turn}`, 'weapons', stateSnapshot)
    }

    // Stagnation check — kills not increasing for many valid turns
    if (totalValidTurns > 5 && (e.killed || 0) === prevKills && prevKills === 0) {
      log('warn', `Zero kills after ${totalValidTurns} valid turns — weapons may not be firing`, 'combat', stateSnapshot)
    }

    log('observation', `Turn ${turn}: HP=${p.hp}/${p.maxHp} Lv=${p.level} XP=${p.xp} Kills=${e.killed} Alive=${e.alive}+${e.ecsAlive || 0} Wave=${wave.currentWave} Wpn=${w.length}`, 'player', stateSnapshot)

    prevKills = e.killed || 0
    prevXp = p.xp || 0
    prevLevel = p.level || 1

    // 6. Periodic actions
    if (turn % 3 === 0) await screenshot(`turn_${turn}`)
    if (turn % 5 === 0) {
      await httpCmd('enemies.spawn', { count: 10 })
      // Post-spawn check
      await sleep(500)
      const postSpawn = await getStateRetry(2)
      if (postSpawn && isValidState(postSpawn)) {
        const pe = postSpawn.enemies || {}
        const postTotal = (pe.alive || 0) + (pe.ecsAlive || 0)
        const postCap = (pe.maxEnemies || 20) + (pe.ecsMaxEnemies || 20)
        if (postTotal > postCap + 10) {
          log('error', `Post-spawn overflow: ${postTotal} vs cap ${postCap}`, 'enemies')
          fileBug('Enemy spawner overflow after stress spawn', 'major', 'enemies',
            '1. Play until enemies spawn\\n2. Inject 10 extra enemies\\n3. Check total alive',
            `${postTotal} enemies alive, cap is ${postCap}`,
            'Enemy count should respect combined cap',
            'Scripts/ECS/EcsEnemySpawner.cs', 'Spawner cap check may not include injected enemies')
        }
      }
    }

    // 7. Get events
    try {
      const events = await httpGet('/events?last=20')
      if (Array.isArray(events)) {
        const types = events.map(e => e.event).filter(Boolean)
        const unique = [...new Set(types)]
        if (unique.length > 0) log('info', `Events: ${unique.join(', ')}`, 'events')
      }
    } catch {}

    await sleep(3000)
  }

  // Final state — use last good state if final read fails
  let finalState = await getStateRetry(3)
  if (!finalState || !isValidState(finalState)) {
    finalState = lastGoodState || {}
  }
  await screenshot('final')
  log('info', `Session complete: ${turn} turns (${totalValidTurns} valid)`, 'summary', finalState)

  // Auto-detect bugs from final state
  const fp = finalState.player || {}
  const fe = finalState.enemies || {}

  if (fp.xp === 0 && (fe.killed || 0) > 10 && totalValidTurns > 5) {
    fileBug('XP not increasing despite kills', 'major', 'progression',
      '1. Start game\\n2. Kill enemies\\n3. Check XP value',
      `XP stays at 0 after ${fe.killed} kills`,
      'XP should increase as enemies are killed and gems collected',
      'Scripts/Player/PlayerLevel.cs', 'Enemies may not drop XP gems or gems not collected')
  }

  if (fp.level === 1 && (fe.killed || 0) > 25 && totalValidTurns > 5) {
    fileBug('Player stuck at level 1', 'major', 'progression',
      '1. Play for 60+ seconds\\n2. Kill 20+ enemies\\n3. Check player level',
      `Still level 1 after ${fe.killed} kills`,
      'Player should level up after collecting enough XP',
      'Scripts/Enemies/EnemyBase.cs', 'XP gem drop or collection may be broken')
  }

  // Check if we had too many invalid reads
  const invalidRate = turn > 0 ? ((turn - totalValidTurns) / turn * 100).toFixed(0) : 0
  if (invalidRate > 30) {
    fileBug('Bridge state reads unreliable', 'minor', 'bridge',
      '1. Run playtest at 3x timescale\\n2. Read /state each turn\\n3. Count invalid responses',
      `${invalidRate}% of state reads returned invalid data`,
      'State reads should be reliable at all timescales',
      'Scripts/Bridge/GameCommandProvider.cs', 'Scene transitions may clear state temporarily')
  }

  // Write report
  const fw = finalState.weapons || []
  const fpass = finalState.passives || []
  const report = [
    `# Playtest Report - ${new Date().toISOString()}`,
    '',
    '## Session Config',
    `- Duration: ${DURATION}s`,
    `- Runner: deterministic (zero LLM calls)`,
    `- Turns: ${turn} (${totalValidTurns} valid, ${invalidRate}% invalid)`,
    '',
    '## Final Stats',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Level | ${fp.level || '?'} |`,
    `| HP | ${fp.hp || '?'}/${fp.maxHp || '?'} |`,
    `| XP | ${fp.xp ?? '?'} / ${fp.xpToNext ?? '?'} |`,
    `| Enemies Killed | ${fe.killed || 0} |`,
    `| Enemies Alive | ${fe.alive || 0} + ${fe.ecsAlive || 0} ECS |`,
    `| Wave | ${finalState.wave?.currentWave ?? '?'} |`,
    `| Weapons | ${fw.map(w => `${w.id}(lv${w.level})`).join(', ') || 'none'} |`,
    `| Passives | ${fpass.map(p => `${p.id}(lv${p.level})`).join(', ') || 'none'} |`,
    '',
  ].join('\n')
  writeFileSync(join(OUTPUT, 'report.md'), report)

  console.log(`[runner] Done. ${turn} turns (${totalValidTurns} valid), ${fe.killed || 0} kills.`)
}

main().catch(e => { console.error(e); process.exit(1) })
