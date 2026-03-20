#!/usr/bin/env node
/**
 * verify.mjs — Automated play session verification via WebSocket bridge.
 *
 * Exports the Godot game, launches it, runs a scripted verification session,
 * captures screenshots and runtime logs, then quits cleanly.
 *
 * All artifacts go to: vampire-mini/project/hosts/complete-app/build/_artifacts/latest/{platform}/
 *
 * Usage:
 *   node verify.mjs [--skip-export] [--platform windows_debug_x86_64] [--duration 45]
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed
 */

import { spawn, execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== CONFIG ====================

const args = process.argv.slice(2);
const SKIP_EXPORT = args.includes("--skip-export");
const PLATFORM = getArg("--platform") || "windows_debug_x86_64";
const DURATION = parseInt(getArg("--duration") || "45", 10);

const GODOT = "C:\\lunar-horse\\tools\\Godot_v4.6.1-stable_mono_win64\\Godot_v4.6.1-stable_mono_win64_console.exe";
const PROJECT = "C:\\lunar-horse\\contract-projects\\vampire-mini\\project\\hosts\\complete-app";
const ARTIFACTS = join(PROJECT, "build", "_artifacts", "latest", PLATFORM);
const BRIDGE_DIR = __dirname;
const BRIDGE_PORT_WS = 9900;
const BRIDGE_PORT_HTTP = 9901;

const EXE_NAME = PLATFORM.startsWith("linux") ? "vampire-survivors" : "vampire-survivors.exe";
const EXE_PATH = join(ARTIFACTS, EXE_NAME);
const LOG_PATH = join(ARTIFACTS, "session.log");
const SNAPSHOTS_PATH = join(ARTIFACTS, "state_snapshots.jsonl");

// ==================== HELPERS ====================

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_PATH, line + "\n"); } catch {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function httpGet(path) {
  const resp = await fetch(`http://127.0.0.1:${BRIDGE_PORT_HTTP}${path}`);
  return resp;
}

async function httpGetJson(path) {
  const resp = await httpGet(path);
  return resp.json();
}

async function cmd(command, cmdArgs = {}) {
  const body = { cmd: command };
  if (Object.keys(cmdArgs).length > 0) body.args = cmdArgs;

  const resp = await fetch(`http://127.0.0.1:${BRIDGE_PORT_HTTP}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function saveScreenshot(filename) {
  // Request screenshot capture and wait for it to arrive
  await cmd("bridge.screenshot");

  // Poll for screenshot to be available (max 3s)
  for (let i = 0; i < 6; i++) {
    await sleep(500);
    try {
      const resp = await httpGet("/screenshot.png");
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length > 100) {
          const path = join(ARTIFACTS, filename);
          writeFileSync(path, buf);
          log(`Screenshot saved: ${filename} (${buf.length} bytes)`);
          return true;
        }
      }
    } catch {}
  }

  log(`Screenshot failed: no data received for ${filename}`);
  return false;
}

async function saveState() {
  try {
    const state = await httpGetJson("/state");
    appendFileSync(SNAPSHOTS_PATH, JSON.stringify(state) + "\n");
    return state;
  } catch {
    return null;
  }
}

async function waitForConnection(maxSeconds = 20) {
  for (let i = 0; i < maxSeconds; i++) {
    try {
      const h = await httpGetJson("/health");
      if (h.connected) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

// ==================== CHECKS ====================

const checks = [];
function check(name, passed, detail = "") {
  checks.push({ name, passed, detail });
  const icon = passed ? "\u2705" : "\u274C";
  log(`${icon} ${name}${detail ? ": " + detail : ""}`);
}

// ==================== MAIN ====================

async function main() {
  console.log("=== Vampire Survivors Mini — Verification Session ===\n");

  // Ensure artifacts directory
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(LOG_PATH, ""); // Clear log
  writeFileSync(SNAPSHOTS_PATH, ""); // Clear snapshots

  log(`Platform: ${PLATFORM}`);
  log(`Artifacts: ${ARTIFACTS}`);
  log(`Duration: ${DURATION}s`);

  // ---- Step 1: Export ----
  if (!SKIP_EXPORT) {
    log("Step 1: Building and exporting...");

    // Update export_presets.cfg to point to artifacts dir
    const presetsPath = join(PROJECT, "export_presets.cfg");
    const relativePath = `build/_artifacts/latest/${PLATFORM}/${EXE_NAME}`;

    if (existsSync(presetsPath)) {
      let presets = (await import("fs")).readFileSync(presetsPath, "utf8");
      presets = presets.replace(
        /export_path="[^"]*"/,
        `export_path="${relativePath}"`
      );
      writeFileSync(presetsPath, presets);
      log(`Export path set to: ${relativePath}`);
    }

    // C# build
    try {
      execSync("dotnet build --no-restore", { cwd: PROJECT, stdio: "pipe" });
      check("C# build", true);
    } catch (e) {
      check("C# build", false, e.stderr?.toString().slice(0, 200));
      return 1;
    }

    // Godot export
    try {
      execSync(
        `"${GODOT}" --headless --export-debug "Windows Desktop" "${relativePath}"`,
        { cwd: PROJECT, stdio: "pipe", timeout: 120000 }
      );
      const exeExists = existsSync(EXE_PATH);
      check("Godot export", exeExists, exeExists ? EXE_PATH : "EXE not found");
      if (!exeExists) return 1;
    } catch (e) {
      check("Godot export", false, e.message?.slice(0, 200));
      return 1;
    }
  } else {
    log("Step 1: Skipping export (--skip-export)");
    check("Godot export", existsSync(EXE_PATH), "Using existing build");
  }

  // ---- Step 2: Kill existing processes ----
  log("Step 2: Cleaning up old processes...");
  try {
    if (process.platform === "win32") {
      // Force-kill prior game and bridge server processes (but not ourselves)
      const myPid = process.pid;
      try {
        // Kill bridge servers (node server.mjs) — exclude our own PID
        execSync(`powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object {$_.Id -ne ${myPid}} | Stop-Process -Force"`, { stdio: "pipe" });
      } catch {}
      try { execSync("taskkill /F /FI \"WINDOWTITLE eq Vampire*\" 2>NUL", { stdio: "pipe" }); } catch {}
      try { execSync("taskkill /F /IM vampire-survivors.exe 2>NUL", { stdio: "pipe" }); } catch {}
    } else {
      try { execSync("pkill -f server.mjs 2>/dev/null", { stdio: "pipe" }); } catch {}
      try { execSync("pkill -f vampire-survivors 2>/dev/null", { stdio: "pipe" }); } catch {}
    }
    await sleep(1000); // Let ports release
  } catch {}

  // ---- Step 3: Start bridge server ----
  log("Step 3: Starting bridge server...");
  const serverProc = spawn("node", ["server.mjs"], {
    cwd: BRIDGE_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let serverReady = false;
  serverProc.stdout.on("data", (d) => {
    const line = d.toString().trim();
    if (line) log(`[bridge] ${line}`);
    if (line.includes("9901")) serverReady = true;
  });
  serverProc.stderr.on("data", (d) => log(`[bridge:err] ${d.toString().trim()}`));

  // Wait for server to bind
  for (let i = 0; i < 10 && !serverReady; i++) await sleep(500);
  await sleep(500);

  // ---- Step 4: Launch game ----
  log("Step 4: Launching game...");
  const gameProc = spawn(EXE_PATH, [], {
    cwd: ARTIFACTS,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  gameProc.stdout.on("data", (d) => {
    for (const line of d.toString().split("\n").filter(Boolean)) {
      log(`[game] ${line.trim()}`);
    }
  });
  gameProc.stderr.on("data", (d) => {
    for (const line of d.toString().split("\n").filter(Boolean)) {
      log(`[game:err] ${line.trim()}`);
    }
  });

  // Wait for WebSocket connection
  log("Waiting for game to connect...");
  const connected = await waitForConnection(20);
  check("Game connects to bridge", connected);
  if (!connected) {
    cleanup(serverProc, gameProc);
    return 1;
  }

  // ---- Step 5: Verification session ----

  // Phase 1: Navigate menu flow (Title → Character → Difficulty → Arena → Gameplay)
  log("\n--- Phase 1: Menu Flow ---");
  await sleep(2000);

  await saveScreenshot("screenshot_title.png");

  const buttons = await cmd("ui.get_buttons");
  const buttonTexts = buttons.value?.map(b => b.text) || [];
  log(`Title buttons: ${JSON.stringify(buttonTexts)}`);
  check("Title screen loaded", buttonTexts.length > 0, JSON.stringify(buttonTexts));

  // Step 1: Click "Classic Mode" on title screen
  log("Clicking Classic Mode...");
  await cmd("ui.click_by_text", { text: "Classic" });
  await sleep(2000);

  // Step 2: Character Select → click "Start Run"
  log("Clicking Start Run (character select)...");
  await cmd("ui.click_by_text", { text: "Start Run" });
  await sleep(2000);

  // Step 3: Difficulty Select → click "Normal"
  log("Clicking Normal difficulty...");
  await cmd("ui.click_by_text", { text: "Normal" });
  await sleep(2000);

  // Step 4: Arena Select → click "Start Run"
  log("Clicking Start Run (arena select)...");
  await cmd("ui.click_by_text", { text: "Start Run" });
  await sleep(3000);

  const scene = await cmd("ui.get_scene");
  const inGameplay = JSON.stringify(scene.value).includes("Main");
  check("Game reached gameplay", inGameplay, JSON.stringify(scene.value));

  // Phase 2: Early Gameplay
  log("\n--- Phase 2: Early Gameplay ---");

  let state = await saveState();
  const hasPlayer = state?.player?.hp > 0;
  check("Player has HP", hasPlayer, `HP=${state?.player?.hp}`);

  const hasWeapons = Array.isArray(state?.weapons) && state.weapons.length > 0;
  check("Weapons equipped", hasWeapons, JSON.stringify(state?.weapons));

  // Wait for enemies to spawn
  log("Waiting 10s for gameplay...");
  await sleep(10000);

  await saveScreenshot("screenshot_gameplay_10s.png");
  state = await saveState();

  const enemiesAlive = state?.enemies?.alive ?? 0;
  check("Enemies spawning", enemiesAlive > 0, `alive=${enemiesAlive}`);

  const kills = state?.enemies?.killed ?? 0;
  log(`Enemies killed so far: ${kills}`);

  // Phase 3: Level-up test
  log("\n--- Phase 3: Level-up Test ---");

  const xpResult = await cmd("player.add_xp", { amount: 100 });
  log(`Add XP result: ${JSON.stringify(xpResult)}`);
  await sleep(1500);

  const levelupOpts = await cmd("ui.levelup_options");
  const levelupVisible = levelupOpts.value?.visible === true;
  check("Level-up menu appears", levelupVisible, JSON.stringify(levelupOpts.value));

  if (levelupVisible) {
    const chooseResult = await cmd("ui.levelup_choose", { option: 1 });
    check("Level-up choice works", chooseResult.value?.chosen === true, chooseResult.value?.text);
    await sleep(1000);
  }

  // Phase 4: Combat stress test
  log("\n--- Phase 4: Combat Stress ---");

  await cmd("enemies.spawn", { count: 30 });
  log("Spawned 30 enemies");

  const remainingTime = Math.max(5, DURATION - 25);
  log(`Waiting ${remainingTime}s for combat...\n`);

  // Periodic state snapshots during combat
  const snapshotInterval = Math.max(5, Math.floor(remainingTime / 3));
  for (let t = 0; t < remainingTime; t += snapshotInterval) {
    await sleep(snapshotInterval * 1000);
    state = await saveState();
    log(`[t+${25 + t + snapshotInterval}s] HP=${state?.player?.hp} Kills=${state?.enemies?.killed} Alive=${state?.enemies?.alive}`);
  }

  await saveScreenshot("screenshot_gameplay_30s.png");

  // Phase 5: Collect events & final state
  log("\n--- Phase 5: Final Data Collection ---");

  let events;
  try {
    events = await httpGetJson("/events?last=200");
    appendFileSync(LOG_PATH, `\n[EVENTS] ${JSON.stringify(events)}\n`);
    log(`Collected ${events.length} events`);
  } catch {
    log("Failed to collect events");
  }

  state = await saveState();
  const finalKills = state?.enemies?.killed ?? 0;
  check("Enemies killed during session", finalKills > 0, `total=${finalKills}`);

  // Check for health_changed events (combat working)
  const healthEvents = (events || []).filter(e => e.event === "health_changed");
  check("Combat damage registered", healthEvents.length > 0, `${healthEvents.length} health events`);

  // Check for level_up events
  const levelEvents = (events || []).filter(e => e.event === "level_up");
  check("Level-up event fired", levelEvents.length > 0, `${levelEvents.length} level events`);

  // Final screenshot
  await saveScreenshot("screenshot_final.png");

  // ---- Step 6: Quit ----
  log("\n--- Quitting ---");
  await cmd("scene.quit");
  await sleep(2000);

  cleanup(serverProc, gameProc);

  // ---- Step 7: Validate artifacts ----
  log("\n--- Artifact Validation ---");

  const requiredFiles = [
    EXE_NAME,
    "session.log",
    "screenshot_title.png",
    "screenshot_gameplay_10s.png",
    "screenshot_gameplay_30s.png",
    "state_snapshots.jsonl",
  ];

  for (const file of requiredFiles) {
    const path = join(ARTIFACTS, file);
    const exists = existsSync(path);
    const size = exists ? statSync(path).size : 0;
    check(`Artifact: ${file}`, exists && size > 0, `${size} bytes`);
  }

  // ---- Summary ----
  console.log("\n========================================");
  console.log("        VERIFICATION SUMMARY");
  console.log("========================================\n");

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  const total = checks.length;

  for (const c of checks) {
    const icon = c.passed ? "\u2705" : "\u274C";
    console.log(`  ${icon} ${c.name}${c.detail ? " — " + c.detail : ""}`);
  }

  console.log(`\n  Result: ${passed}/${total} passed, ${failed} failed`);
  console.log(`  Artifacts: ${ARTIFACTS}`);
  console.log(`  Log: ${LOG_PATH}\n`);

  // Write summary to log
  appendFileSync(LOG_PATH, `\n[SUMMARY] ${passed}/${total} passed, ${failed} failed\n`);

  return failed > 0 ? 1 : 0;
}

function cleanup(serverProc, gameProc) {
  try { gameProc?.kill(); } catch {}
  try { serverProc?.kill(); } catch {}

  // Force cleanup on Windows
  if (process.platform === "win32") {
    try { execSync("taskkill /F /FI \"WINDOWTITLE eq Vampire*\" 2>NUL", { stdio: "pipe" }); } catch {}
  }
}

// ==================== RUN ====================

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  });
