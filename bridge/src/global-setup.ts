/**
 * Vitest Global Setup — starts bridge server + game before all tests,
 * tears down after all tests complete.
 *
 * The game runs as an exported build from build/_artifacts/latest/{platform}/
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_DIR = join(__dirname, '..')

// Platform detection
const IS_WIN = process.platform === 'win32'
const PLATFORM = process.env.PLATFORM ?? (IS_WIN ? 'windows_debug_x86_64' : 'linux_debug_x86_64')
const PROJECT_ROOT = process.env.PROJECT_ROOT ?? 'C:\\lunar-horse\\contract-projects\\vampire-mini\\project\\hosts\\complete-app'
const ARTIFACTS = join(PROJECT_ROOT, 'build', '_artifacts', 'latest', PLATFORM)
const EXE_NAME = IS_WIN ? 'vampire-survivors.exe' : 'vampire-survivors'
const EXE_PATH = join(ARTIFACTS, EXE_NAME)

let serverProc: ChildProcess | null = null
let gameProc: ChildProcess | null = null

export async function setup() {
  console.log('\n🎮 Global Setup: Starting bridge server + game...\n')

  // Verify exported build exists
  if (!existsSync(EXE_PATH)) {
    throw new Error(
      `Exported game not found at ${EXE_PATH}\n` +
      `Run 'node verify.mjs' first to build, or set PROJECT_ROOT/PLATFORM env vars.`
    )
  }

  // Kill lingering processes
  killExisting()

  // Start bridge server
  serverProc = spawn('node', ['server.mjs'], {
    cwd: BRIDGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Wait for server to be ready
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 5000) // max 5s
    serverProc!.stdout!.on('data', (data: Buffer) => {
      const line = data.toString()
      if (line.includes('9901')) {
        clearTimeout(timeout)
        resolve()
      }
    })
  })

  console.log('  ✅ Bridge server started')

  // Start game
  gameProc = spawn(EXE_PATH, [], {
    cwd: ARTIFACTS,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Wait for game to connect to bridge
  const connected = await waitForGameConnection(20)
  if (!connected) {
    throw new Error('Game did not connect to bridge within 20s')
  }

  console.log('  ✅ Game connected to bridge')
  console.log(`  📁 Artifacts: ${ARTIFACTS}\n`)

  // Store for teardown
  ;(globalThis as Record<string, unknown>).__bridgeServerProc = serverProc
  ;(globalThis as Record<string, unknown>).__gameProc = gameProc
  ;(globalThis as Record<string, unknown>).__artifactsDir = ARTIFACTS
}

export async function teardown() {
  console.log('\n🎮 Global Teardown: Stopping game + bridge...\n')

  // Try graceful quit first
  try {
    await fetch('http://127.0.0.1:9901/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'scene.quit' }),
    })
    await new Promise(r => setTimeout(r, 2000))
  } catch { /* game might already be gone */ }

  // Force kill
  try { gameProc?.kill() } catch {}
  try { serverProc?.kill() } catch {}

  killExisting()
  console.log('  ✅ Cleanup complete\n')
}

function killExisting() {
  if (IS_WIN) {
    try { execSync('taskkill /F /IM vampire-survivors.exe 2>NUL', { stdio: 'pipe' }) } catch {}
  } else {
    try { execSync('pkill -f vampire-survivors 2>/dev/null', { stdio: 'pipe' }) } catch {}
  }
}

async function waitForGameConnection(maxSeconds: number): Promise<boolean> {
  for (let i = 0; i < maxSeconds; i++) {
    try {
      const resp = await fetch('http://127.0.0.1:9901/health')
      const data = await resp.json() as { connected: boolean }
      if (data.connected) return true
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}
