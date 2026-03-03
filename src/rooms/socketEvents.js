'use strict';
const { rateLimit } = require('express-rate-limit');
const boggleEngine = require('../engine/boggle');
const rhythmEngine = require('../engine/rhythm');

// ─── In-memory room store ────────────────────────────────────────────────────
/** roomId -> roomData */
const rooms = new Map();
/** socketId -> roomId */
const playerRooms = new Map();
/** socketId -> { name, color, seat } – kept across disconnects */
const playerMeta = new Map();

// ─── Game metadata ───────────────────────────────────────────────────────────
const GAME_META = {
  rhythm: {
    label: 'Rhythm Tap',
    minPlayers: 2,
    maxPlayers: 4,
    colors: ['blue', 'red', 'green', 'purple'],
    path: '/rhythm-game.html'
  },
  boggle: {
    label: 'Boggle',
    minPlayers: 2,
    maxPlayers: 4,
    colors: ['blue', 'red', 'green', 'purple'],
    path: '/boggle-game.html'
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function sanitizeName(name) {
  return String(name || 'Anonymous').replace(/[<>&"']/g, '').slice(0, 30).trim() || 'Anonymous';
}

function buildRoomState(room) {
  return {
    roomId: room.id,
    gameType: room.gameType,
    players: room.players.map(p => ({
      name: p.name,
      color: p.color,
      seat: p.seat,
      connected: p.connected
    })),
    maxPlayers: room.maxPlayers,
    started: room.started
  };
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function removePlayerFromRoom(socketId, io) {
  const roomId = playerRooms.get(socketId);
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  const idx = room.players.findIndex(p => p.socketId === socketId);
  if (idx !== -1) {
    room.players[idx].connected = false;
    room.players[idx].socketId = null;
  }

  // If no connected players remain, destroy room after a delay
  const hasConnected = room.players.some(p => p.connected);
  if (!hasConnected) {
    setTimeout(() => {
      if (!rooms.has(roomId)) return;
      const r = rooms.get(roomId);
      if (!r.players.some(p => p.connected)) {
        if (r.roundTimer) clearTimeout(r.roundTimer);
        rooms.delete(roomId);
      }
    }, 30000);
  } else {
    io.to(roomId).emit('room_update', buildRoomState(room));
  }

  playerRooms.delete(socketId);
}

// ─── Per-socket join rate limiter (simple in-memory) ─────────────────────────
const joinAttempts = new Map();
function checkJoinRate(ip) {
  const now = Date.now();
  const entry = joinAttempts.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  joinAttempts.set(ip, entry);
  return entry.count <= 10;
}

// ─── Main export ─────────────────────────────────────────────────────────────
function setupSocketEvents(io) {
  io.on('connection', socket => {
    const ip = socket.handshake.address;

    // ── Ping / latency ──────────────────────────────────────────────────────
    socket.on('ping', cb => { if (typeof cb === 'function') cb(); });

    // ── Join game ───────────────────────────────────────────────────────────
    socket.on('join_game', ({ name, gameType, roomId: requestedRoomId } = {}) => {
      if (!checkJoinRate(ip)) {
        return socket.emit('error', { message: 'Too many join attempts. Please wait.' });
      }

      const cleanName = sanitizeName(name);
      const gt = String(gameType || '').toLowerCase();
      const meta = GAME_META[gt];
      if (!meta) {
        return socket.emit('error', { message: 'Unknown game type.' });
      }

      let room;
      let isReconnect = false;

      // ── Try to reconnect by name ────────────────────────────────────────
      if (requestedRoomId) {
        room = rooms.get(requestedRoomId.toUpperCase());
        if (!room) {
          return socket.emit('error', { message: 'Room not found.' });
        }
        if (room.gameType !== gt) {
          return socket.emit('error', { message: 'Wrong game type for this room.' });
        }

        const existing = room.players.find(p => p.name === cleanName && !p.connected);
        if (existing) {
          // Reconnect
          existing.socketId = socket.id;
          existing.connected = true;
          isReconnect = true;
          playerRooms.set(socket.id, room.id);
          playerMeta.set(socket.id, { name: existing.name, color: existing.color, seat: existing.seat });
          socket.join(room.id);

          socket.emit('joined', {
            roomId: room.id,
            color: existing.color,
            seat: existing.seat,
            name: existing.name,
            isReconnect: true,
            state: buildRoomState(room)
          });

          if (room.started && room.game) {
            // Re-send game state for reconnection
            socket.emit('game_started', {
              gameType: room.gameType,
              board: room.game.beats || room.game.board,
              beats: room.game.beats,
              roundDuration: room.game.roundDuration,
              countdown: room.game.countdown || 3000,
              bpm: room.game.bpm,
              startTime: room.gameStartTime
            });
          }

          io.to(room.id).emit('room_update', buildRoomState(room));
          return;
        }

        // New player joining existing room
        if (room.started) {
          return socket.emit('error', { message: 'Game already started.' });
        }
        if (room.players.length >= room.maxPlayers) {
          return socket.emit('error', { message: 'Room is full.' });
        }
      } else {
        // Create new room
        const newId = makeRoomId();
        room = {
          id: newId,
          gameType: gt,
          maxPlayers: meta.maxPlayers,
          minPlayers: meta.minPlayers,
          players: [],
          host: socket.id,
          started: false,
          game: null,
          gameStartTime: null,
          roundTimer: null
        };
        rooms.set(newId, room);
      }

      // Assign color/seat
      const usedColors = room.players.map(p => p.color);
      const color = meta.colors.find(c => !usedColors.includes(c)) || meta.colors[0];
      const seat = room.players.length;

      const playerData = {
        socketId: socket.id,
        name: cleanName,
        color,
        seat,
        connected: true
      };
      room.players.push(playerData);
      playerRooms.set(socket.id, room.id);
      playerMeta.set(socket.id, { name: cleanName, color, seat });
      socket.join(room.id);

      socket.emit('joined', {
        roomId: room.id,
        color,
        seat,
        name: cleanName,
        isReconnect: false,
        state: buildRoomState(room)
      });

      io.to(room.id).emit('room_update', buildRoomState(room));
    });

    // ── Start game ───────────────────────────────────────────────────────────
    socket.on('start_game', ({ roomId } = {}) => {
      const room = getRoom(roomId);
      if (!room) return socket.emit('error', { message: 'Room not found.' });
      if (room.host !== socket.id) return socket.emit('error', { message: 'Only the host can start.' });
      if (room.started) return;

      const connected = room.players.filter(p => p.connected);
      if (connected.length < room.minPlayers) {
        return socket.emit('error', {
          message: `Need at least ${room.minPlayers} players to start.`
        });
      }

      room.started = true;
      const pCount = room.players.length;

      if (room.gameType === 'boggle') {
        room.game = boggleEngine.createGame(pCount);
        const startTime = Date.now() + 1000; // 1 second buffer
        room.gameStartTime = startTime;

        io.to(roomId).emit('game_started', {
          gameType: 'boggle',
          board: room.game.board,
          roundDuration: room.game.roundDuration,
          startTime
        });

        // Auto-end round after roundDuration + buffer
        room.roundTimer = setTimeout(() => endBoggleRound(room, io), room.game.roundDuration + 2000);

      } else if (room.gameType === 'rhythm') {
        room.game = rhythmEngine.createGame(pCount);
        const startTime = Date.now() + 500;
        room.gameStartTime = startTime;

        io.to(roomId).emit('game_started', {
          gameType: 'rhythm',
          beats: room.game.beats,
          roundDuration: room.game.roundDuration,
          countdown: room.game.countdown,
          bpm: room.game.bpm,
          startTime
        });

        // Auto-end round
        room.roundTimer = setTimeout(() => endRhythmRound(room, io), room.game.roundDuration + 2000);
      }
    });

    // ── Boggle: submit word ──────────────────────────────────────────────────
    socket.on('boggle_submit', ({ roomId, word } = {}) => {
      const room = getRoom(roomId);
      if (!room || !room.started || room.gameType !== 'boggle') return;

      const meta = playerMeta.get(socket.id);
      if (!meta) return;
      const { seat } = meta;

      const result = boggleEngine.submitWord(room.game, seat, word || '');
      socket.emit('boggle_result', result);

      if (result.valid) {
        // Broadcast score update to room
        io.to(roomId).emit('boggle_score_update', {
          seat,
          color: meta.color,
          name: meta.name,
          word: result.word,
          points: result.points
        });
      }
    });

    // ── Boggle: client signals round end ─────────────────────────────────────
    socket.on('boggle_end', ({ roomId } = {}) => {
      const room = getRoom(roomId);
      if (!room || !room.started) return;
      // Only the server timer triggers final results; ignore client signals
    });

    // ── Rhythm: tap (real-time tap broadcast for opponent feedback) ──────────
    socket.on('rhythm_tap', ({ roomId, time: clientTime } = {}) => {
      const room = getRoom(roomId);
      if (!room || !room.started || room.gameType !== 'rhythm') return;
      const meta = playerMeta.get(socket.id);
      if (!meta) return;
      // Broadcast tap to opponents so they see activity
      socket.to(roomId).emit('rhythm_opponent_tap', { seat: meta.seat, color: meta.color });
    });

    // ── Rhythm: submit final score ────────────────────────────────────────────
    socket.on('rhythm_score', ({ roomId, scoreData } = {}) => {
      const room = getRoom(roomId);
      if (!room || !room.started || room.gameType !== 'rhythm') return;
      const meta = playerMeta.get(socket.id);
      if (!meta) return;

      rhythmEngine.setScore(room.game, meta.seat, scoreData);

      // Check if all connected players have submitted
      const connectedSeats = room.players.filter(p => p.connected).map(p => p.seat);
      const submitted = connectedSeats.every(s => room.game.scores[s] !== undefined);
      if (submitted) {
        if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
        endRhythmRound(room, io);
      }
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      removePlayerFromRoom(socket.id, io);
      playerMeta.delete(socket.id);
    });
  });
}

// ─── Round-end helpers ────────────────────────────────────────────────────────
function endBoggleRound(room, io) {
  if (!room.started) return;
  room.started = false;

  const { finalScores, uniqueWords, winner } = boggleEngine.endRound(room.game);

  const playerResults = room.players.map((p, i) => ({
    name: p.name,
    color: p.color,
    seat: p.seat,
    score: finalScores[i] || 0,
    words: uniqueWords[i] || []
  }));

  const winnerData = winner >= 0
    ? { seat: winner, name: room.players[winner]?.name || '' }
    : null;

  io.to(room.id).emit('game_over', {
    gameType: 'boggle',
    players: playerResults,
    winner: winnerData
  });
}

function endRhythmRound(room, io) {
  if (!room.started) return;
  room.started = false;

  const { scores, winner } = rhythmEngine.getResults(room.game);

  const playerResults = room.players.map((p, i) => ({
    name: p.name,
    color: p.color,
    seat: p.seat,
    score: scores[i] || { totalScore: 0, perfect: 0, great: 0, ok: 0, miss: 0 }
  }));

  const winnerSeat = winner !== null ? parseInt(winner) : null;
  const winnerData = winnerSeat !== null && room.players[winnerSeat]
    ? { seat: winnerSeat, name: room.players[winnerSeat].name }
    : null;

  io.to(room.id).emit('game_over', {
    gameType: 'rhythm',
    players: playerResults,
    winner: winnerData
  });
}

module.exports = { setupSocketEvents };
