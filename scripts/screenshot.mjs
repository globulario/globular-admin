#!/usr/bin/env node
// Captures a screenshot of the active Chrome tab via CDP (port 9222)
// Usage: node scripts/screenshot.mjs [output_path]
// Requires: Chrome with --remote-debugging-port=9222

import http from 'node:http';
import fs from 'node:fs';

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const OUTPUT = process.argv[2] || '/tmp/browser-screenshot.png';

// Find the best page target (prefer non-devtools)
const targets = await fetchJSON(`http://${CDP_HOST}:${CDP_PORT}/json`);
const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'))
           || targets.find(t => t.type === 'page');

if (!page) {
  console.error('No browser page found. Is Chrome running with --remote-debugging-port=9222?');
  process.exit(1);
}

console.error(`Capturing: ${page.title} (${page.url})`);

// Connect via native WebSocket and send Page.captureScreenshot
const screenshot = await captureScreenshot(page.webSocketDebuggerUrl);
fs.writeFileSync(OUTPUT, Buffer.from(screenshot, 'base64'));
console.log(OUTPUT);

// --- helpers ---

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function captureScreenshot(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 10000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });

    ws.addEventListener('message', (event) => {
      // event.data may be a string or Blob; in Node.js it's a string
      const raw = typeof event.data === 'string' ? event.data : event.data.toString();
      const msg = JSON.parse(raw);
      if (msg.id === 1) {
        clearTimeout(timeout);
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result.data);
      }
    });

    ws.addEventListener('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}
