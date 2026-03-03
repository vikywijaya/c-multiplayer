'use strict';
/* global io, QRCode */

// ─── URL parameters ────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const GAME_TYPE = params.get('game') || 'boggle';
const INVITE_ROOM = params.get('room') || null;

const GAME_META = {
  rhythm: { label: 'Rhythm Tap', path: '/rhythm-game.html', min: 2, max: 4 },
  boggle: { label: 'Boggle',     path: '/boggle-game.html', min: 2, max: 4 }
};

const meta = GAME_META[GAME_TYPE] || GAME_META.boggle;

// ─── DOM refs ──────────────────────────────────────────────────────────────
const lobbyTitle    = document.getElementById('lobbyTitle');
const nameInput     = document.getElementById('nameInput');
const createBtn     = document.getElementById('createBtn');
const statusMsg     = document.getElementById('statusMsg');
const joinCard      = document.getElementById('joinCard');
const shareCard     = document.getElementById('shareCard');
const qrContainer   = document.getElementById('qrCode');
const joinLinkEl    = document.getElementById('joinLink');
const playerListEl  = document.getElementById('playerList');
const startBtn      = document.getElementById('startBtn');
const waitMsg       = document.getElementById('waitMsg');

lobbyTitle.textContent = meta.label + ' Lobby';

// ─── Socket ────────────────────────────────────────────────────────────────
const socket = io({ transports: ['websocket', 'polling'] });

let myRoomId   = null;
let myColor    = null;
let mySeat     = null;
let myName     = null;
let isHost     = false;

// ─── Helpers ───────────────────────────────────────────────────────────────
function setStatus(msg, isErr = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isErr ? 'var(--danger)' : '';
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const COLOR_LABELS = {
  blue:   'Player 1',
  red:    'Player 2',
  green:  'Player 3',
  purple: 'Player 4'
};

function renderPlayers(players) {
  playerListEl.innerHTML = players.map(p => `
    <div class="player-chip player-chip--${esc(p.color)} ${p.connected ? '' : 'disconnected'}">
      <span class="player-chip__dot"></span>
      <span class="player-chip__name">${esc(p.name)}</span>
      <span class="player-chip__role">${esc(COLOR_LABELS[p.color] || p.color)}</span>
      ${p.connected ? '' : '<span class="player-chip__dc">(offline)</span>'}
    </div>
  `).join('');
}

function showSharePanel(roomId) {
  joinCard.hidden = true;
  shareCard.hidden = false;

  const joinUrl = `${window.location.origin}/join?game=${GAME_TYPE}&room=${roomId}`;
  joinLinkEl.textContent = joinUrl;

  qrContainer.innerHTML = '';
  new QRCode(qrContainer, { text: joinUrl, width: 180, height: 180 });
}

// ─── Create / join flow ────────────────────────────────────────────────────
function joinGame(roomId) {
  const name = nameInput.value.trim();
  if (!name) { setStatus('Please enter your name.', true); return; }
  myName = name;
  setStatus('Connecting…');
  createBtn.disabled = true;
  socket.emit('join_game', { name, gameType: GAME_TYPE, roomId: roomId || null });
}

createBtn.addEventListener('click', () => joinGame(INVITE_ROOM));
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(INVITE_ROOM); });

startBtn.addEventListener('click', () => {
  socket.emit('start_game', { roomId: myRoomId });
});

// If arriving via invite link, pre-fill game type hint
if (INVITE_ROOM) {
  setStatus(`Joining room ${INVITE_ROOM}…`);
}

// ─── Socket events ─────────────────────────────────────────────────────────
socket.on('connect', () => {
  document.getElementById('connStatus')?.setAttribute && null; // optional
});

socket.on('joined', ({ roomId, color, seat, name, isReconnect, state }) => {
  myRoomId = roomId;
  myColor  = color;
  mySeat   = seat;
  myName   = name;
  isHost   = seat === 0;

  showSharePanel(roomId);
  renderPlayers(state.players);

  if (isHost) {
    waitMsg.textContent = `Waiting for players… (${state.players.length}/${meta.max})`;
    if (state.players.filter(p => p.connected).length >= meta.min) {
      startBtn.hidden = false;
    }
  } else {
    startBtn.hidden = true;
    waitMsg.textContent = 'Waiting for host to start the game…';
  }
});

socket.on('room_update', state => {
  renderPlayers(state.players);
  const connected = state.players.filter(p => p.connected).length;
  waitMsg.textContent = isHost
    ? `Waiting for players… (${connected}/${meta.max})`
    : 'Waiting for host to start the game…';

  if (isHost && connected >= meta.min) {
    startBtn.hidden = false;
  }
});

socket.on('game_started', () => {
  const url = `${meta.path}?room=${myRoomId}&color=${myColor}&name=${encodeURIComponent(myName)}&seat=${mySeat}`;
  window.location.href = url;
});

socket.on('error', ({ message }) => {
  setStatus(message, true);
  createBtn.disabled = false;
});
