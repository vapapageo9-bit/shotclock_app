const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ---- Shared authoritative state (same for every connected device) ----
const state = {
  timeLeft: 24.0,   // seconds, decimals for smooth display
  mode: 24,         // 24 or 14 (what a full reset means right now)
  running: false,
  buzzer: false,    // pulsed true for a moment when it hits 0
};

const TICK_MS = 100; // 10 times per second

function broadcast() {
  const msg = JSON.stringify({ type: 'state', ...state });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

setInterval(() => {
  if (state.running) {
    state.timeLeft = Math.max(0, +(state.timeLeft - TICK_MS / 1000).toFixed(2));
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      state.running = false;
      state.buzzer = true;
      broadcast();
      // clear buzzer flag shortly after so it can be re-triggered next time
      setTimeout(() => { state.buzzer = false; }, 1500);
      return;
    }
  }
  broadcast();
}, TICK_MS);

function handleCommand(cmd) {
  switch (cmd.type) {
    // Toggle start/stop for the 24s clock. If we're not already in 24 mode,
    // switch to it, load 24.0 and start running immediately.
    case 'toggle24':
      if (state.mode !== 24) {
        state.mode = 24;
        state.timeLeft = 24;
        state.running = true;
        state.buzzer = false;
      } else {
        if (state.timeLeft > 0) state.running = !state.running;
      }
      break;

    // Same behaviour for the 14s clock.
    case 'toggle14':
      if (state.mode !== 14) {
        state.mode = 14;
        state.timeLeft = 14;
        state.running = true;
        state.buzzer = false;
      } else {
        if (state.timeLeft > 0) state.running = !state.running;
      }
      break;

    // Single reset: reloads whichever mode is currently active (24 or 14)
    // back to its full value and stops the clock.
    case 'reset':
      state.timeLeft = state.mode;
      state.running = false;
      state.buzzer = false;
      break;

    // Manual override: operator types in a custom time (e.g. 7.3) and it
    // gets loaded into the clock immediately, stopped, ready to start.
    case 'setTime': {
      const value = Number(cmd.value);
      if (Number.isFinite(value) && value >= 0 && value <= 99) {
        state.timeLeft = Math.round(value * 10) / 10; // keep one decimal
        state.running = false;
        state.buzzer = false;
      }
      break;
    }

    default:
      break;
  }
  broadcast();
}

wss.on('connection', (ws) => {
  // send current state immediately to the newly connected device
  ws.send(JSON.stringify({ type: 'state', ...state }));

  ws.on('message', (data) => {
    try {
      const cmd = JSON.parse(data);
      handleCommand(cmd);
    } catch (e) {
      // ignore malformed messages
    }
  });
});

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n24/14 Shot Clock server running!`);
  console.log(`  Local:   http://localhost:${PORT}`);
  getLocalIPs().forEach((ip) => {
    console.log(`  Network: http://${ip}:${PORT}   <-- use this link on other devices`);
  });
  console.log(`\nAll devices that open one of the links above will see the SAME clock.\n`);
});
