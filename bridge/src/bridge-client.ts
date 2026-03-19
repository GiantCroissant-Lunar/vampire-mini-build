/**
 * BridgeClient — Typed client for Vitest scenarios to interact with the running game.
 *
 * Talks to the bridge HTTP server (not directly to WebSocket).
 * Provides typed commands, state polling, screenshot capture, and event collection.
 */

import { writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import type {
  AckMessage,
  StateMessage,
  EventMessage,
  PlayerState,
  WeaponState,
  PassiveState,
  EnemySnapshot,
  WaveState,
  CommandName,
} from './protocol.js'

export interface BridgeClientOptions {
  httpPort?: number
  artifactsDir?: string
  /** Default timeout for commands (ms) */
  cmdTimeout?: number
}

export class BridgeClient {
  private baseUrl: string
  private artifactsDir: string
  private cmdTimeout: number
  private screenshotCount = 0
  private logPath: string
  private snapshotsPath: string

  constructor(options: BridgeClientOptions = {}) {
    const port = options.httpPort ?? 9901
    this.baseUrl = `http://127.0.0.1:${port}`
    this.artifactsDir = options.artifactsDir ?? './artifacts'
    this.cmdTimeout = options.cmdTimeout ?? 5000

    mkdirSync(this.artifactsDir, { recursive: true })
    this.logPath = join(this.artifactsDir, 'scenario.log')
    this.snapshotsPath = join(this.artifactsDir, 'state_snapshots.jsonl')
  }

  // ==================== Core HTTP ====================

  private async get<T = unknown>(path: string): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`)
    if (!resp.ok) throw new Error(`GET ${path} → ${resp.status}`)
    return resp.json() as T
  }

  private async post<T = AckMessage>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`POST ${path} → ${resp.status}`)
    return resp.json() as T
  }

  // ==================== Commands ====================

  /** Send a command and wait for ack */
  async cmd(command: CommandName | string, args?: Record<string, unknown>): Promise<AckMessage> {
    const body: Record<string, unknown> = { cmd: command }
    if (args && Object.keys(args).length > 0) body.args = args
    return this.post<AckMessage>('/cmd', body)
  }

  /** Send command, assert it succeeded, return value */
  async cmdOk(command: CommandName | string, args?: Record<string, unknown>): Promise<unknown> {
    const ack = await this.cmd(command, args)
    if (!ack.ok) throw new Error(`Command '${command}' failed: ${ack.error}`)
    return ack.value
  }

  // ==================== State Queries ====================

  /** Get latest full game state */
  async state(): Promise<StateMessage> {
    return this.get<StateMessage>('/state')
  }

  /** Get player state */
  async player(): Promise<PlayerState> {
    const s = await this.state()
    if (!s.player) throw new Error('No player state available')
    return s.player
  }

  /** Get weapons list */
  async weapons(): Promise<WeaponState[]> {
    const s = await this.state()
    return s.weapons ?? []
  }

  /** Get passives list */
  async passives(): Promise<PassiveState[]> {
    const s = await this.state()
    return s.passives ?? []
  }

  /** Get enemy snapshot */
  async enemies(): Promise<EnemySnapshot> {
    const s = await this.state()
    return s.enemies ?? { alive: 0, killed: 0, totalSpawned: 0 }
  }

  /** Get wave state */
  async wave(): Promise<WaveState> {
    const s = await this.state()
    if (!s.wave) throw new Error('No wave state available')
    return s.wave
  }

  // ==================== Health Check ====================

  async isConnected(): Promise<boolean> {
    try {
      const h = await this.get<{ connected: boolean }>('/health')
      return h.connected
    } catch {
      return false
    }
  }

  /** Wait for game to connect to bridge */
  async waitForConnection(maxSeconds = 30): Promise<boolean> {
    for (let i = 0; i < maxSeconds; i++) {
      if (await this.isConnected()) return true
      await sleep(1000)
    }
    return false
  }

  // ==================== Polling / Waiting ====================

  /** Wait until a condition on game state is met */
  async waitForState(
    predicate: (state: StateMessage) => boolean,
    timeoutMs = 15000,
    pollMs = 500,
    label = 'state condition'
  ): Promise<StateMessage> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const s = await this.state()
        if (predicate(s)) return s
      } catch { /* state not ready yet */ }
      await sleep(pollMs)
    }
    throw new Error(`Timeout waiting for ${label} (${timeoutMs}ms)`)
  }

  /** Wait until player is alive and has HP */
  async waitForGameplay(timeoutMs = 15000): Promise<StateMessage> {
    return this.waitForState(
      s => (s.player?.hp ?? 0) > 0 && s.player?.alive === true,
      timeoutMs,
      500,
      'gameplay started'
    )
  }

  /** Wait for scene to be a specific scene */
  async waitForScene(sceneName: string, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const scene = await this.cmd('ui.get_scene')
        if (JSON.stringify(scene.value).includes(sceneName)) return
      } catch { /* not ready */ }
      await sleep(500)
    }
    throw new Error(`Timeout waiting for scene '${sceneName}' (${timeoutMs}ms)`)
  }

  // ==================== Events ====================

  /** Get recent events */
  async events(last = 50): Promise<EventMessage[]> {
    return this.get<EventMessage[]>(`/events?last=${last}`)
  }

  /** Get events since a specific event ID */
  async eventsSince(id: number): Promise<EventMessage[]> {
    return this.get<EventMessage[]>(`/events?since=${id}`)
  }

  /** Clear all events */
  async clearEvents(): Promise<void> {
    await this.get('/clear-events')
  }

  // ==================== Screenshots ====================

  /** Take a screenshot and save to artifacts */
  async screenshot(filename?: string): Promise<string> {
    // Request capture
    await this.cmd('bridge.screenshot')
    await sleep(1500)

    // Download PNG
    const resp = await fetch(`${this.baseUrl}/screenshot.png`)
    if (!resp.ok) throw new Error(`Screenshot failed: ${resp.status}`)

    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length < 100) throw new Error('Screenshot too small — likely empty')

    const name = filename ?? `screenshot_${++this.screenshotCount}.png`
    const path = join(this.artifactsDir, name)
    writeFileSync(path, buf)
    this.log(`Screenshot: ${name} (${buf.length} bytes)`)
    return path
  }

  // ==================== State Snapshots ====================

  /** Save current state to JSONL file */
  async snapshot(label?: string): Promise<StateMessage> {
    const s = await this.state()
    const entry = { _label: label, _ts: new Date().toISOString(), ...s }
    appendFileSync(this.snapshotsPath, JSON.stringify(entry) + '\n')
    return s
  }

  // ==================== Game Flow Helpers ====================

  /** Navigate to title screen and click Start (or detect already in gameplay) */
  async startGame(): Promise<void> {
    // Check if already in gameplay
    try {
      const p = await this.player()
      if (p.alive && p.hp > 0) {
        this.log('Already in gameplay — skipping start')
        return
      }
    } catch { /* no player state yet — need to start */ }

    await this.cmd('scene.start_game')
    await this.waitForGameplay(15000)
    this.log('Game started — player alive')
  }

  /** Quit the game cleanly */
  async quit(): Promise<void> {
    try {
      await this.cmd('scene.quit')
    } catch { /* game may close before ack */ }
  }

  /** Pause the game */
  async pause(): Promise<void> {
    await this.cmdOk('bridge.pause')
  }

  /** Unpause the game */
  async unpause(): Promise<void> {
    await this.cmdOk('bridge.unpause')
  }

  /** Set timescale (0-10) */
  async setTimescale(scale: number): Promise<void> {
    await this.cmdOk('bridge.set_timescale', { scale })
  }

  /** Add XP and optionally wait for level-up menu */
  async addXpAndLevelUp(amount = 200): Promise<boolean> {
    await this.cmd('player.add_xp', { amount })
    await sleep(1000)
    const opts = await this.cmd('ui.levelup_options')
    return (opts.value as { visible?: boolean })?.visible === true
  }

  /** Choose a level-up option (1-indexed) */
  async chooseLevelUp(option: number): Promise<void> {
    await this.cmdOk('ui.levelup_choose', { option })
    await sleep(500)
  }

  /** Spawn enemies */
  async spawnEnemies(count: number): Promise<void> {
    await this.cmd('enemies.spawn', { count })
  }

  /** Inject movement input */
  async move(x: number, y: number): Promise<void> {
    await this.cmd('input.move', { x, y })
  }

  // ==================== Logging ====================

  log(msg: string): void {
    const ts = new Date().toISOString()
    const line = `[${ts}] ${msg}`
    console.log(line)
    try { appendFileSync(this.logPath, line + '\n') } catch { /* ok */ }
  }
}

// ==================== Utilities ====================

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
