'use strict';
require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { rateLimit } = require('express-rate-limit');
const { setupSocketEvents } = require('./src/rooms/socketEvents');

const app = express();
const httpServer = createServer(app);
const corsOrigin = process.env.CORS_ORIGIN || '*';

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// ── Redis adapter (required for Vercel / multi-instance deployments) ─────────
// Set UPSTASH_REDIS_URL in your environment to enable.
// Without it the server runs with in-memory state (fine for single-instance).
if (process.env.UPSTASH_REDIS_URL) {
  const { createAdapter } = require('@socket.io/redis-adapter');
  const Redis = require('ioredis');
  const pubClient = new Redis(process.env.UPSTASH_REDIS_URL, { tls: { rejectUnauthorized: false } });
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.IO using Redis adapter (Upstash)');
}

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200
});

app.use(limiter);
app.use(express.static('public'));

app.get('/join', (req, res) => {
  res.sendFile('lobby.html', { root: 'public' });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: io.sockets.adapter.rooms.size,
    connections: io.sockets.sockets.size
  });
});

setupSocketEvents(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, httpServer, io };
