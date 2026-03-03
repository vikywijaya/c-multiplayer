'use strict';
require('dotenv').config();

const path = require('path');
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

// Redis adapter — required for Vercel (multiple instances share room state).
// Set UPSTASH_REDIS_URL in Vercel environment variables to enable.
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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: io.sockets.adapter.rooms.size,
    connections: io.sockets.sockets.size
  });
});

setupSocketEvents(io);

// On Vercel, the platform manages the HTTP server — do NOT call listen().
// Locally (and on Railway/Fly.io/Render), start the server normally.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export the HTTP server so Vercel (and tests) can use it as the handler.
module.exports = httpServer;
