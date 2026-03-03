'use strict';
/* global io */

// ─── URL parameters ────────────────────────────────────────────────────────
const params   = new URLSearchParams(window.location.search);
const ROOM_ID  = params.get('room')  || '';
const MY_COLOR = params.get('color') || 'blue';
const MY_NAME  = decodeURIComponent(params.get('name') || 'Player');
const MY_SEAT  = parseInt(params.get('seat') || '0', 10);

if (!ROOM_ID) { window.location.href = '/'; }

// ─── DOM refs ──────────────────────────────────────────────────────────────
const connStatus      = document.getElementById('connStatus');
const waitOverlay     = document.getElementById('waitOverlay');
const waitMsg         = document.getElementById('waitMsg');
const waitPlayerList  = document.getElementById('waitPlayerList');
const resultsOverlay  = document.getElementById('resultsOverlay');
const resultsBody     = document.getElementById('resultsBody');
const playAgainBtn    = document.getElementById('playAgainBtn');
const reconnectOverlay= document.getElementById('reconnectOverlay');
const scoreChips      = document.getElementById('scoreChips');
const timerValue      = document.getElementById('timerValue');
const boardEl         = document.getElementById('boggleBoard');
const currentWordEl   = document.getElementById('currentWord');
const wordFeedback    = document.getElementById('wordFeedback');
const submitWordBtn   = document.getElementById('submitWordBtn');
const clearWordBtn    = document.getElementById('clearWordBtn');
const foundWordsList  = document.getElementById('foundWordsList');

// ─── Game state ────────────────────────────────────────────────────────────
let board          = [];       // 16-letter array
let selectedPath   = [];       // indices of selected tiles
let myScore        = 0;
let foundWords     = [];       // { word, points }
let gameActive     = false;
let roundTimer     = null;
let timerInterval  = null;

// ─── SmartTV D-pad navigation ──────────────────────────────────────────────
let focusedIndex   = 0;        // 0-15: current focused tile; 16: Submit; 17: Clear

// ─── Socket ────────────────────────────────────────────────────────────────
const socket = io({ transports: ['polling', 'websocket'] });

socket.on('connect', () => {
  connStatus.textContent = 'Connected';
  connStatus.classList.add('connected');
  socket.emit('join_game', { name: MY_NAME, gameType: 'boggle', roomId: ROOM_ID });
});

socket.on('disconnect', () => {
  connStatus.textContent = 'Disconnected';
  connStatus.classList.remove('connected');
  reconnectOverlay.hidden = false;
});

socket.on('joined', ({ state }) => {
  renderWaitPlayers(state.players);
  waitMsg.textContent = `Waiting for host… (${state.players.filter(p => p.connected).length}/${state.maxPlayers})`;
});

socket.on('room_update', state => {
  renderWaitPlayers(state.players);
});

socket.on('game_started', ({ board: b, roundDuration, startTime }) => {
  board = b;
  gameActive = true;
  reconnectOverlay.hidden = true;
  waitOverlay.hidden = true;
  renderBoard();
  renderScoreChips();
  startTimer(startTime, roundDuration);
  focusedIndex = 0;
  updateFocus();
});

socket.on('boggle_result', ({ valid, word, points, reason }) => {
  if (valid) {
    myScore += points;
    foundWords.push({ word, points });
    showFeedback(`✓ ${word} +${points}pt${points !== 1 ? 's' : ''}`, 'success');
    renderFoundWords();
    renderScoreChips();
    clearSelection();
  } else {
    showFeedback(`✗ ${reason || 'Invalid'}`, 'error');
    shakePath();
  }
});

socket.on('boggle_score_update', ({ seat, color, name, word, points }) => {
  if (seat !== MY_SEAT) {
    // Show opponent found a word
    updateOpponentChip(seat, color);
  }
});

socket.on('game_over', ({ players, winner }) => {
  gameActive = false;
  clearInterval(timerInterval);
  clearTimeout(roundTimer);
  showResults(players, winner);
});

socket.on('error', ({ message }) => {
  waitMsg.textContent = message;
});

// ─── Board rendering ────────────────────────────────────────────────────────
function renderBoard() {
  boardEl.innerHTML = '';
  board.forEach((letter, i) => {
    const tile = document.createElement('div');
    tile.className = 'boggle-tile';
    tile.dataset.index = i;
    tile.textContent = letter.toUpperCase();
    tile.setAttribute('role', 'gridcell');
    tile.setAttribute('aria-label', `Letter ${letter}`);
    tile.setAttribute('tabindex', i === 0 ? '0' : '-1');

    // Mouse / touch selection
    tile.addEventListener('pointerdown', e => { e.preventDefault(); startDrag(i); });
    tile.addEventListener('pointerenter', e => { if (e.buttons === 1) extendDrag(i); });
    tile.addEventListener('pointerup', () => endDrag());

    boardEl.appendChild(tile);
  });
}

function getTile(i) { return boardEl.children[i]; }

// ─── D-pad navigation ──────────────────────────────────────────────────────
function updateFocus() {
  // Remove focus from all
  Array.from(boardEl.children).forEach((t, i) => {
    t.classList.toggle('focused', i === focusedIndex && focusedIndex < 16);
    t.tabIndex = (i === focusedIndex && focusedIndex < 16) ? 0 : -1;
  });

  submitWordBtn.classList.toggle('focused', focusedIndex === 16);
  clearWordBtn.classList.toggle('focused', focusedIndex === 17);

  if (focusedIndex < 16) getTile(focusedIndex)?.focus();
  else if (focusedIndex === 16) submitWordBtn.focus();
  else if (focusedIndex === 17) clearWordBtn.focus();
}

document.addEventListener('keydown', e => {
  if (!gameActive) return;

  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      if (focusedIndex < 15) focusedIndex++;
      else if (focusedIndex === 15) focusedIndex = 16;
      else if (focusedIndex === 16) focusedIndex = 17;
      else focusedIndex = 0;
      updateFocus();
      break;

    case 'ArrowLeft':
      e.preventDefault();
      if (focusedIndex > 0 && focusedIndex <= 15) focusedIndex--;
      else if (focusedIndex === 16) focusedIndex = 15;
      else if (focusedIndex === 17) focusedIndex = 16;
      else focusedIndex = 17;
      updateFocus();
      break;

    case 'ArrowDown':
      e.preventDefault();
      if (focusedIndex < 12) focusedIndex += 4;
      else if (focusedIndex < 16) focusedIndex = 16;
      else if (focusedIndex === 16) focusedIndex = 17;
      updateFocus();
      break;

    case 'ArrowUp':
      e.preventDefault();
      if (focusedIndex >= 4 && focusedIndex < 16) focusedIndex -= 4;
      else if (focusedIndex === 16 || focusedIndex === 17) focusedIndex = 12;
      updateFocus();
      break;

    case 'Enter':
    case ' ':
      e.preventDefault();
      if (focusedIndex < 16) {
        toggleTileSelection(focusedIndex);
      } else if (focusedIndex === 16) {
        submitWord();
      } else if (focusedIndex === 17) {
        clearSelection();
      }
      break;

    case 'Backspace':
    case 'GoBack':
      e.preventDefault();
      removeLastSelected();
      break;

    case 'Tab':
      // Allow Tab to navigate to Submit/Clear buttons
      break;
  }
});

// ─── Tile selection ────────────────────────────────────────────────────────
function isAdjacent(a, b) {
  const ar = Math.floor(a / 4), ac = a % 4;
  const br = Math.floor(b / 4), bc = b % 4;
  return Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1 && a !== b;
}

function toggleTileSelection(index) {
  if (selectedPath.includes(index)) {
    // Deselect if it's the last one
    if (selectedPath[selectedPath.length - 1] === index) {
      removeLastSelected();
    }
    return;
  }

  // Must be adjacent to last selected
  if (selectedPath.length > 0 && !isAdjacent(selectedPath[selectedPath.length - 1], index)) {
    showFeedback('Letters must be adjacent!', 'error');
    return;
  }

  selectedPath.push(index);
  getTile(index)?.classList.add('selected');
  updateCurrentWord();
}

function removeLastSelected() {
  if (selectedPath.length === 0) return;
  const last = selectedPath.pop();
  getTile(last)?.classList.remove('selected', 'path');
  updateCurrentWord();
}

function clearSelection() {
  selectedPath.forEach(i => getTile(i)?.classList.remove('selected', 'path'));
  selectedPath = [];
  updateCurrentWord();
}

function updateCurrentWord() {
  currentWordEl.textContent = selectedPath.map(i => board[i].toUpperCase()).join('');
}

// ─── Drag select (mouse/touch) ─────────────────────────────────────────────
let dragging = false;
function startDrag(index) {
  dragging = true;
  clearSelection();
  selectedPath = [index];
  getTile(index)?.classList.add('selected');
  updateCurrentWord();
}
function extendDrag(index) {
  if (!dragging) return;
  if (selectedPath.includes(index)) return;
  if (selectedPath.length > 0 && !isAdjacent(selectedPath[selectedPath.length - 1], index)) return;
  selectedPath.push(index);
  getTile(index)?.classList.add('selected');
  updateCurrentWord();
}
function endDrag() { dragging = false; }

// ─── Submit word ───────────────────────────────────────────────────────────
submitWordBtn.addEventListener('click', submitWord);
clearWordBtn.addEventListener('click', clearSelection);

function submitWord() {
  const word = selectedPath.map(i => board[i]).join('');
  if (word.length < 3) {
    showFeedback('Need at least 3 letters!', 'error');
    return;
  }
  socket.emit('boggle_submit', { roomId: ROOM_ID, word });
}

function shakePath() {
  selectedPath.forEach(i => {
    const t = getTile(i);
    if (!t) return;
    t.classList.add('shake');
    setTimeout(() => t.classList.remove('shake'), 400);
  });
}

// ─── Timer ─────────────────────────────────────────────────────────────────
function startTimer(startTime, duration) {
  const endTime = startTime + duration;
  timerInterval = setInterval(() => {
    const rem = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    timerValue.textContent = rem;
    if (rem <= 10) timerValue.classList.add('urgent');
    if (rem === 0) clearInterval(timerInterval);
  }, 200);
}

// ─── Score chips ────────────────────────────────────────────────────────────
function renderScoreChips() {
  scoreChips.innerHTML = `
    <div class="score-chip score-chip--${esc(MY_COLOR)}" data-seat="${MY_SEAT}">
      <span class="chip-name">${esc(MY_NAME)}</span>
      <span class="chip-score" id="myScore">${myScore}</span>
    </div>
  `;
}

function updateOpponentChip(seat, color) {
  let chip = document.querySelector(`.score-chip[data-seat="${seat}"]`);
  if (!chip) {
    chip = document.createElement('div');
    chip.className = `score-chip score-chip--${esc(color)}`;
    chip.dataset.seat = seat;
    chip.innerHTML = `<span class="chip-name">Opponent</span><span class="chip-score" id="oppScore_${seat}">…</span>`;
    scoreChips.appendChild(chip);
  }
  chip.classList.add('tapped');
  setTimeout(() => chip.classList.remove('tapped'), 300);
}

// ─── Found words list ──────────────────────────────────────────────────────
function renderFoundWords() {
  foundWordsList.innerHTML = `
    <p class="found-header">My words (${myScore} pts)</p>
    ${foundWords.slice().reverse().map(w =>
      `<div class="found-word">${esc(w.word)} <span class="found-pts">+${w.points}</span></div>`
    ).join('')}
  `;
}

// ─── Feedback ──────────────────────────────────────────────────────────────
let feedbackTimer = null;
function showFeedback(text, type) {
  wordFeedback.textContent = text;
  wordFeedback.className = `boggle-feedback boggle-feedback--${type} visible`;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => wordFeedback.classList.remove('visible'), 2000);
}

// ─── Results ──────────────────────────────────────────────────────────────
function showResults(players, winner) {
  resultsOverlay.hidden = false;

  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

  resultsBody.innerHTML = sorted.map((p, i) => {
    const isWinner = winner && winner.seat === p.seat;
    const words    = p.words || [];
    return `
      <div class="result-row result-row--${esc(p.color)} ${isWinner ? 'result-row--winner' : ''}">
        <div class="result-top">
          <span class="result-rank">${['🥇','🥈','🥉'][i] || ''}</span>
          <span class="result-name">${esc(p.name)}</span>
          <span class="result-score">${p.score || 0} pts</span>
        </div>
        <div class="result-words">${words.map(w => `<span class="rw">${esc(w.word)}&nbsp;+${w.points}</span>`).join('')}</div>
      </div>
    `;
  }).join('');
}

playAgainBtn.addEventListener('click', () => {
  window.location.href = `/join?game=boggle&room=${ROOM_ID}`;
});

// ─── Helpers ───────────────────────────────────────────────────────────────
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
