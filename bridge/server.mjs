import { WebSocketServer } from 'ws';
import http from 'node:http';

const WS_PORT = parseInt(process.env.WS_PORT || '9900');
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '9901');

// --- State ---
let gameClient = null;
let latestState = null;
let latestScreenshot = null;  // { width, height, format, data }
const events = [];       // ring buffer
const MAX_EVENTS = 500;
let eventId = 0;
const pendingCmds = new Map(); // id -> { resolve, timer }

// --- WebSocket Server (Godot connects here) ---
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`[bridge] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  if (gameClient) {
    console.log('[bridge] Replacing existing game connection');
    gameClient.close();
  }
  gameClient = ws;
  console.log('[bridge] Game connected');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'state') {
        latestState = msg;
      } else if (msg.type === 'screenshot') {
        latestScreenshot = msg.payload;
        console.log(`[bridge] Screenshot received: ${msg.payload.width}x${msg.payload.height}`);
      } else if (msg.type === 'event') {
        msg._eventId = ++eventId;
        events.push(msg);
        if (events.length > MAX_EVENTS) events.shift();
      } else if (msg.type === 'ack') {
        const pending = pendingCmds.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve(msg);
          pendingCmds.delete(msg.id);
        }
      }
    } catch (e) {
      console.error('[bridge] Bad JSON from game:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[bridge] Game disconnected');
    if (gameClient === ws) gameClient = null;
  });

  ws.on('error', (err) => {
    console.error('[bridge] WebSocket error:', err.message);
  });
});

// --- HTTP Server (Claude Code curls here) ---
const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const url = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    res.end(JSON.stringify({ connected: gameClient !== null }));
    return;
  }

  // GET /state
  if (req.method === 'GET' && url.pathname === '/state') {
    if (!latestState) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'No state yet (game not connected or no state received)' }));
      return;
    }
    res.end(JSON.stringify(latestState));
    return;
  }

  // GET /events?last=N or /events?since=ID
  if (req.method === 'GET' && url.pathname === '/events') {
    const last = parseInt(url.searchParams.get('last') || '0');
    const since = parseInt(url.searchParams.get('since') || '0');

    let result;
    if (last > 0) {
      result = events.slice(-last);
    } else if (since > 0) {
      result = events.filter(e => e._eventId > since);
    } else {
      result = events.slice(-20); // default last 20
    }
    res.end(JSON.stringify(result));
    return;
  }

  // POST /cmd
  if (req.method === 'POST' && url.pathname === '/cmd') {
    if (!gameClient || gameClient.readyState !== 1) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'Game not connected' }));
      return;
    }

    const body = await readBody(req);
    let cmd;
    try {
      cmd = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Ensure type and id
    cmd.type = 'cmd';
    if (!cmd.id) cmd.id = `http_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Send to game and wait for ack
    const ackPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCmds.delete(cmd.id);
        resolve({ type: 'ack', id: cmd.id, ok: false, error: 'Timeout (2s)' });
      }, 2000);
      pendingCmds.set(cmd.id, { resolve, timer });
    });

    gameClient.send(JSON.stringify(cmd));
    const ack = await ackPromise;
    res.end(JSON.stringify(ack));
    return;
  }

  // GET /screenshot — returns latest screenshot as base64 JSON
  if (req.method === 'GET' && url.pathname === '/screenshot') {
    if (!latestScreenshot) {
      // Request one from the game
      if (gameClient && gameClient.readyState === 1) {
        gameClient.send(JSON.stringify({ type: 'cmd', id: 'ss_req', cmd: 'bridge.screenshot', args: {} }));
        // Wait up to 3s for screenshot
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!latestScreenshot) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'No screenshot available' }));
        return;
      }
    }
    res.end(JSON.stringify(latestScreenshot));
    return;
  }

  // GET /screenshot.png — returns raw PNG image
  if (req.method === 'GET' && url.pathname === '/screenshot.png') {
    if (!latestScreenshot) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'text/plain');
      res.end('No screenshot available');
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.end(Buffer.from(latestScreenshot.data, 'base64'));
    return;
  }

  // GET /clear-events
  if (req.method === 'GET' && url.pathname === '/clear-events') {
    events.length = 0;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // 404
  res.statusCode = 404;
  res.end(JSON.stringify({
    error: 'Not found',
    routes: [
      'GET /health',
      'GET /state',
      'GET /events?last=N',
      'GET /events?since=ID',
      'POST /cmd {cmd, args}',
      'GET /screenshot',
      'GET /screenshot.png',
      'GET /clear-events'
    ]
  }));
});

httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`[bridge] HTTP API listening on http://127.0.0.1:${HTTP_PORT}`);
  console.log('[bridge] Routes: GET /health, /state, /events | POST /cmd');
});

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
  });
}
