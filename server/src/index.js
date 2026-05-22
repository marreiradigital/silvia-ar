import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tryConnectDB } from './db.js';
import { createRoomsRepo } from './rooms-repo.js';
import { createGames } from './games.js';
import { mountRoutes } from './routes.js';
import { attachSocketHandlers } from './sockets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get('/healthz', (req, res) => {
    res.json({
        ok: true,
        service: 'silvia-server',
        env: NODE_ENV,
        uptime: process.uptime(),
        ts: Date.now(),
    });
});

// Estáticos: index.html (cliente do jogo), test.html (debug), favicon.svg
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = await tryConnectDB();
if (db) {
    console.log('[db] MySQL connected');
} else {
    console.warn('[db] No MySQL — using in-memory store (dev only)');
}

const rooms = createRoomsRepo({ db });
const games = createGames();
mountRoutes(app, { rooms });

const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    pingInterval: 20000,
    pingTimeout: 25000,
});

attachSocketHandlers(io, { rooms, games });

httpServer.listen(PORT, () => {
    console.log(`[silvia] http+ws listening on :${PORT} (${NODE_ENV})`);
});

const shutdown = (signal) => {
    console.log(`[silvia] ${signal} received, closing...`);
    io.close(() => {
        httpServer.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
