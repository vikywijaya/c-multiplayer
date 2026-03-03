'use strict';
/* global io */

// ─── URL parameters ────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('room')  || '';
const MY_COLOR = params.get('color') || 'blue';
const MY_NAME  = decodeURIComponent(params.get('name') || 'Player');
const MY_SEAT  = parseInt(params.get('seat') || '0', 10);

if (!ROOM_ID) { window.location.href = '/'; }

// ─── DOM refs ──────────────────────────────────────────────────────────────
const connStatus     = document.getElementById('connStatus');
const waitOverlay    = document.getElementById('waitOverlay');
const waitMsg        = document.getElementById('waitMsg');
const waitPlayerList = document.getElementById('waitPlayerList');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNum   = document.getElementById('countdownNum');
const resultsOverlay = document.getElementById('resultsOverlay');
const resultsBody    = document.getElementById('resultsBody');
const playAgainBtn   = document.getElementById('playAgainBtn');
const reconnectOverlay = document.getElementById('reconnectOverlay');
const scoreChips     = document.getElementById('scoreChips');
const timerValue     = document.getElementById('timerValue');
const tapFeedback    = document.getElementById('tapFeedback');
const tapBtn         = document.getElementById('tapBtn');
const canvas         = document.getElementById('trackCanvas');
const ctx            = canvas.getContext('2d');

// ─── Game state ────────────────────────────────────────────────────────────
let beats         = [];       // { id, time } array
let gameStartTime = null;     // server-sent start timestamp
let roundDuration = 60000;
let bpm           = 120;
let roundTimer    = null;
let animFrame     = null;

// Local scoring
let localScore    = 0;
let perfect       = 0, great = 0, ok = 0, miss = 0;

// Displayed notes: { id, time, hit, missed }
let notes         = [];

// Opponents score state
const playerScores = {}; // seat -> { name, color, score }

const TRACK_SPEED_PPS = 300; // pixels per second for note movement
const HIT_ZONE_X = 80;       // pixels from left edge

// ─── Socket ────────────────────────────────────────────────────────────────
const socket = io({ transports: ['polling', 'websocket'] });

socket.on('connect', () => {
  connStatus.textContent = 'Connected';
  connStatus.classList.add('connected');
  socket.emit('join_game', { name: MY_NAME, gameType: 'rhythm', roomId: ROOM_ID });
});

socket.on('disconnect', () => {
  connStatus.textContent = 'Disconnected';
  connStatus.classList.remove('connected');
  reconnectOverlay.hidden = false;
});

socket.on('connect_error', () => {
  connStatus.textContent = 'Connection error';
});

socket.on('joined', ({ state }) => {
  renderWaitPlayers(state.players);
  waitMsg.textContent = `Waiting for host to start… (${state.players.filter(p => p.connected).length}/${state.maxPlayers})`;
});

socket.on('room_update', state => {
  renderWaitPlayers(state.players);
  waitMsg.textContent = `Waiting… (${state.players.filter(p => p.connected).length}/${state.maxPlayers})`;
});

socket.on('game_started', data => {
  beats = data.beats || [];
  roundDuration = data.roundDuration || 60000;
  bpm = data.bpm || 120;
  gameStartTime = data.startTime;
  reconnectOverlay.hidden = true;

  // Init opponent score display
  if (data.players) {
    data.players.forEach(p => {
      playerScores[p.seat] = { name: p.name, color: p.color, score: 0 };
    });
  }

  startCountdown(gameStartTime - Date.now());
});

socket.on('rhythm_opponent_tap', ({ seat, color }) => {
  // Flash opponent chip
  const chip = document.querySelector(`.score-chip[data-seat="${seat}"]`);
  if (chip) {
    chip.classList.add('tapped');
    setTimeout(() => chip.classList.remove('tapped'), 200);
  }
});

socket.on('game_over', ({ players, winner }) => {
  stopRound();
  showResults(players, winner);
});

socket.on('error', ({ message }) => {
  waitMsg.textContent = message;
});

// ─── Countdown ─────────────────────────────────────────────────────────────
function startCountdown(msUntilStart) {
  waitOverlay.hidden = true;
  countdownOverlay.hidden = false;

  const show = (n) => { countdownNum.textContent = n; };
  const secLeft = Math.ceil(msUntilStart / 1000);
  show(Math.max(secLeft, 1));

  const interval = setInterval(() => {
    const now = Date.now();
    const rem = Math.ceil((gameStartTime - now) / 1000);
    if (rem <= 0) {
      clearInterval(interval);
      countdownOverlay.hidden = true;
      startRound();
    } else {
      show(rem);
    }
  }, 250);
}

// ─── Round start ────────────────────────────────────────────────────────────
function startRound() {
  notes = beats.map(b => ({ ...b, hit: false, missed: false }));
  resizeCanvas();
  renderScoreChips();
  animFrame = requestAnimationFrame(gameLoop);

  // Round timer
  const elapsed = Date.now() - gameStartTime;
  const remaining = roundDuration - elapsed;
  roundTimer = setTimeout(() => submitScore(), Math.max(remaining, 0) + 500);

  timerValue.textContent = Math.ceil(remaining / 1000);
  const timerInterval = setInterval(() => {
    const rem = gameStartTime + roundDuration - Date.now();
    if (rem <= 0) { timerValue.textContent = '0'; clearInterval(timerInterval); }
    else { timerValue.textContent = Math.ceil(rem / 1000); }
  }, 200);
}

function stopRound() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
}

// ─── Canvas game loop ───────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = canvas.parentElement.clientWidth  || 800;
  canvas.height = canvas.parentElement.clientHeight || 120;
}

function gameLoop() {
  const now  = Date.now();
  const elapsed = now - gameStartTime;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cy = canvas.height / 2;
  const noteR = 22;

  // Draw track line
  ctx.strokeStyle = '#334';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(HIT_ZONE_X, cy);
  ctx.lineTo(canvas.width, cy);
  ctx.stroke();

  // Draw hit zone circle
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(HIT_ZONE_X, cy, noteR + 6, 0, Math.PI * 2);
  ctx.stroke();

  // Draw notes
  for (const note of notes) {
    if (note.hit || note.missed) continue;
    // Position: note arrives at HIT_ZONE_X exactly when elapsed == note.time
    const msAhead = note.time - elapsed;
    const x = HIT_ZONE_X + (msAhead / 1000) * TRACK_SPEED_PPS;

    if (x < -noteR * 2) {
      // Missed
      note.missed = true;
      miss++;
      showFeedback('MISS', '#e74c3c');
      updateScoreChip();
      continue;
    }
    if (x > canvas.width + noteR) continue;

    ctx.beginPath();
    ctx.arc(x, cy, noteR, 0, Math.PI * 2);
    ctx.fillStyle = '#4fc3f7';
    ctx.fill();
    ctx.strokeStyle = '#01579b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  animFrame = requestAnimationFrame(gameLoop);
}

// ─── Tap handling ──────────────────────────────────────────────────────────
function onTap() {
  if (!gameStartTime || !animFrame) return;
  const now = Date.now();
  const elapsed = now - gameStartTime;

  socket.emit('rhythm_tap', { roomId: ROOM_ID, time: elapsed });

  // Find nearest unhit note
  let closest = null;
  let minOffset = Infinity;
  for (const note of notes) {
    if (note.hit || note.missed) continue;
    const offset = Math.abs(note.time - elapsed);
    if (offset < minOffset) { minOffset = offset; closest = note; }
  }

  if (closest && minOffset <= 250) {
    closest.hit = true;
    const { grade, points } = gradeOffset(minOffset);
    localScore += points;
    if (grade === 'PERFECT') perfect++;
    else if (grade === 'GREAT') great++;
    else ok++;

    const colors = { PERFECT: '#ffd700', GREAT: '#00e676', OK: '#ffb74d' };
    showFeedback(`${grade} +${points}`, colors[grade] || '#fff');
    updateScoreChip();
  } else {
    showFeedback('MISS', '#e74c3c');
  }
}

function gradeOffset(offset) {
  if (offset <= 50)  return { grade: 'PERFECT', points: 3 };
  if (offset <= 120) return { grade: 'GREAT',   points: 2 };
  if (offset <= 220) return { grade: 'OK',       points: 1 };
  return { grade: 'MISS', points: 0 };
}

tapBtn.addEventListener('click', onTap);
document.addEventListener('keydown', e => {
  if (resultsOverlay.hidden === false) return; // ignore during results
  if (['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
  }
  if (animFrame) onTap();
});

// ─── Feedback flash ────────────────────────────────────────────────────────
let feedbackTimer = null;
function showFeedback(text, color) {
  tapFeedback.textContent = text;
  tapFeedback.style.color = color;
  tapFeedback.classList.add('visible');
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => tapFeedback.classList.remove('visible'), 700);
}

// ─── Score chip rendering ──────────────────────────────────────────────────
function renderScoreChips() {
  scoreChips.innerHTML = '';
  const chip = document.createElement('div');
  chip.className = `score-chip score-chip--${MY_COLOR}`;
  chip.dataset.seat = MY_SEAT;
  chip.innerHTML = `<span class="chip-name">${esc(MY_NAME)}</span><span class="chip-score" id="myScore">0</span>`;
  scoreChips.appendChild(chip);
}

function updateScoreChip() {
  const el = document.getElementById('myScore');
  if (el) el.textContent = localScore;
}

// ─── Submit score ──────────────────────────────────────────────────────────
function submitScore() {
  stopRound();
  socket.emit('rhythm_score', {
    roomId: ROOM_ID,
    scoreData: { totalScore: localScore, perfect, great, ok, miss }
  });
}

// ─── Results ──────────────────────────────────────────────────────────────
function showResults(players, winner) {
  stopRound();
  resultsOverlay.hidden = false;

  const sorted = [...players].sort((a, b) =>
    (b.score?.totalScore || 0) - (a.score?.totalScore || 0)
  );

  resultsBody.innerHTML = sorted.map((p, i) => {
    const s = p.score || {};
    const isWinner = winner && winner.seat === p.seat;
    return `
      <div class="result-row result-row--${esc(p.color)} ${isWinner ? 'result-row--winner' : ''}">
        <span class="result-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
        <span class="result-name">${esc(p.name)}</span>
        <span class="result-score">${s.totalScore || 0} pts</span>
        <span class="result-detail">
          ✨${s.perfect||0} / 👍${s.great||0} / 👌${s.ok||0} / ❌${s.miss||0}
        </span>
      </div>
    `;
  }).join('');
}

playAgainBtn.addEventListener('click', () => {
  window.location.href = `/join?game=rhythm&room=${ROOM_ID}`;
});

// ─── Wait overlay helpers ──────────────────────────────────────────────────
function renderWaitPlayers(players) {
  waitPlayerList.innerHTML = players.map(p => `
    <div class="player-chip player-chip--${esc(p.color)}">
      <span class="player-chip__name">${esc(p.name)}</span>
    </div>
  `).join('');
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.addEventListener('resize', () => { if (animFrame) resizeCanvas(); });
