// Browser dev mode: runs the backend in Node and exposes it over a WebSocket (renderer: vite.web.config.ts).

import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { createBackend, dispatch } from '../backend/api';
import { onEmit } from '../backend/events';
import { setPlatform } from '../backend/platform';

const PORT = Number(process.env['KSMAIL_WS_PORT'] ?? 5199);
setPlatform({ dataDir: process.env['KSMAIL_DATA'] ?? path.join(process.cwd(), '.devdata'), version: '0.1.0-dev' });

const backend = createBackend();
const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });
const clients = new Set<WebSocket>();

onEmit((channel, payload) => {
  const msg = JSON.stringify({ type: 'event', channel, payload });
  for (const c of clients) c.send(msg);
});

const ALLOWED_ORIGINS = new Set(['http://localhost:5184', 'http://127.0.0.1:5184']);

wss.on('connection', (ws, req) => {
  // websites open in the same browser must not be able to talk to the backend
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    ws.close(1008, 'origin not allowed');
    return;
  }
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', async (data) => {
    const { id, method, args } = JSON.parse(String(data)) as { id: number; method: string; args: unknown[] };
    try {
      const value = await dispatch(backend.api, method, args);
      ws.send(JSON.stringify({ type: 'result', id, ok: true, value }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'result', id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
  });
});

console.log(`[ks-mail] backend ws://127.0.0.1:${PORT}`);

const stop = async (): Promise<void> => {
  await backend.shutdown();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
