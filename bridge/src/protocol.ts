/**
 * Bridge Protocol — Single source of truth for all message types
 * between Vitest scenarios ↔ Bridge Server ↔ Godot AgentBridge.
 *
 * quicktype can generate C# from this if needed:
 *   npx quicktype --src protocol.ts --lang csharp --out BridgeProtocol.cs
 */

// ===================== Envelopes =====================

/** Agent → Game command */
export interface CommandMessage {
  type: 'cmd'
  id: string
  cmd: string
  args?: Record<string, unknown>
}

/** Game → Agent acknowledgement */
export interface AckMessage {
  type: 'ack'
  id: string
  ok: boolean
  value?: unknown
  error?: string
}

/** Game → Agent periodic state broadcast */
export interface StateMessage {
  type: 'state'
  player?: PlayerState
  weapons?: WeaponState[]
  passives?: PassiveState[]
  enemies?: EnemySnapshot
  wave?: WaveState
  bridge?: BridgeConfig
}

/** Game → Agent event notification */
export interface EventMessage {
  type: 'event'
  event: string
  data?: Record<string, unknown>
  _eventId?: number
}

/** Game → Agent screenshot */
export interface ScreenshotMessage {
  type: 'screenshot'
  payload: ScreenshotPayload
}

/** Agent → Game config update */
export interface ConfigMessage {
  type: 'config'
  payload: Partial<BridgeConfig>
}

export type IncomingMessage = AckMessage | StateMessage | EventMessage | ScreenshotMessage
export type OutgoingMessage = CommandMessage | ConfigMessage

// ===================== State Types =====================

export interface PlayerState {
  hp: number
  maxHp: number
  level: number
  xp: number
  xpToNext: number
  position: Vec2
  speed: number
  alive: boolean
}

export interface WeaponState {
  id: string
  name: string
  level: number
  damage?: number
  cooldown?: number
}

export interface PassiveState {
  id: string
  name: string
  level: number
}

export interface EnemySnapshot {
  alive: number
  killed: number
  totalSpawned: number
}

export interface WaveState {
  currentWave: number
  spawnInterval: number
  difficulty: number
  maxEnemies: number
}

export interface BridgeConfig {
  broadcastRate: number
  screenshotInterval: number
  screenshotEnabled: boolean
  timescale: number
  paused: boolean
}

export interface ScreenshotPayload {
  width: number
  height: number
  format: 'png' | 'jpeg'
  data: string  // base64
}

export interface Vec2 {
  x: number
  y: number
}

// ===================== Command Names =====================

/** All known bridge commands — autocomplete for scenarios */
export const Commands = {
  // Bridge control
  'bridge.pause': {} as void,
  'bridge.unpause': {} as void,
  'bridge.set_timescale': {} as { scale: number },
  'bridge.screenshot': {} as void,
  'bridge.set_broadcast_rate': {} as { fps: number },
  'bridge.list_commands': {} as void,
  'bridge.get_config': {} as void,

  // Scene navigation
  'scene.start_game': {} as void,
  'scene.title': {} as void,
  'scene.change': {} as { scene: string },
  'scene.reload': {} as void,
  'scene.quit': {} as void,

  // Player
  'player.get_state': {} as void,
  'player.heal': {} as { amount: number },
  'player.damage': {} as { amount: number },
  'player.add_xp': {} as { amount: number },
  'player.set_speed': {} as { speed: number },
  'player.teleport': {} as { x: number; y: number },
  'player.set_invincible': {} as { enabled: boolean },

  // Weapons
  'weapons.get_state': {} as void,
  'weapons.add': {} as { id: string; scene?: string },
  'weapons.upgrade': {} as { id: string },
  'weapons.remove': {} as { id: string },

  // Passives
  'passives.get_state': {} as void,
  'passives.add': {} as { id: string; scene?: string },
  'passives.remove': {} as { id: string },

  // Enemies
  'enemies.get_state': {} as void,
  'enemies.spawn': {} as { count: number },
  'enemies.kill_all': {} as void,
  'enemies.set_spawn_interval': {} as { interval: number },

  // Wave
  'wave.get_state': {} as void,

  // UI
  'ui.get_buttons': {} as void,
  'ui.get_labels': {} as void,
  'ui.get_scene': {} as void,
  'ui.get_tree': {} as void,
  'ui.click': {} as { path: string },
  'ui.click_by_text': {} as { text: string },
  'ui.focus': {} as { path: string },
  'ui.levelup_choose': {} as { option: number },
  'ui.levelup_options': {} as void,

  // Input injection
  'input.move': {} as { x: number; y: number },
  'input.dash': {} as void,
} as const

export type CommandName = keyof typeof Commands
