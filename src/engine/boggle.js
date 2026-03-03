'use strict';
const fs = require('fs');
const path = require('path');

// Load word dictionary
const WORD_SET = new Set(
  fs.readFileSync(path.join(__dirname, 'boggle-words.txt'), 'utf8')
    .split('\n')
    .map(w => w.trim().toUpperCase())
    .filter(w => w.length >= 3)
);

// Standard Boggle dice (16 dice, each with 6 faces)
const BOGGLE_DICE = [
  'AAEEGN', 'ELRTTY', 'AOOTTW', 'ABBJOO',
  'EHRTVW', 'CIMOTV', 'DISTTY', 'EIOSST',
  'DELRVY', 'ACHOPS', 'HIMNQU', 'EEINSU',
  'EEGHNW', 'AFFKPS', 'HLNNRZ', 'DEILRX'
];

function generateBoard() {
  const dice = [...BOGGLE_DICE];
  // Shuffle dice positions
  for (let i = dice.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dice[i], dice[j]] = [dice[j], dice[i]];
  }
  // Roll each die
  return dice.map(die => {
    const face = die[Math.floor(Math.random() * die.length)];
    return face === 'Q' ? 'Qu' : face;
  });
}

function getNeighbors(index) {
  const row = Math.floor(index / 4);
  const col = index % 4;
  const neighbors = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
        neighbors.push(nr * 4 + nc);
      }
    }
  }
  return neighbors;
}

function canFormWord(board, word) {
  const target = word.toUpperCase().replace(/QU/g, 'Q').split('');

  function dfs(cellIndex, letterIndex, visited) {
    if (letterIndex === target.length) return true;
    const cellLetter = board[cellIndex].toUpperCase().replace(/QU/g, 'Q');
    if (cellLetter !== target[letterIndex]) return false;

    const neighbors = getNeighbors(cellIndex);
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        if (dfs(n, letterIndex + 1, visited)) return true;
        visited.delete(n);
      }
    }
    return false;
  }

  for (let i = 0; i < 16; i++) {
    const cellLetter = board[i].toUpperCase().replace(/QU/g, 'Q');
    if (cellLetter === target[0]) {
      const visited = new Set([i]);
      if (dfs(i, 1, visited)) return true;
    }
  }
  return false;
}

function scoreWord(word) {
  const len = word.length;
  if (len <= 4) return 1;
  if (len === 5) return 2;
  if (len === 6) return 3;
  if (len === 7) return 5;
  return 11; // 8+
}

function createGame(playerCount) {
  const board = generateBoard();
  return {
    board,
    playerCount,
    submissions: Array.from({ length: playerCount }, () => ({})),
    roundDuration: 60000
  };
}

function submitWord(game, seat, word) {
  const upper = word.toUpperCase();
  if (upper.length < 3) return { valid: false, reason: 'Too short (min 3 letters)' };
  if (!WORD_SET.has(upper)) return { valid: false, reason: 'Not a valid word' };
  if (game.submissions[seat] && game.submissions[seat][upper]) {
    return { valid: false, reason: 'Already found' };
  }
  if (!canFormWord(game.board, upper)) {
    return { valid: false, reason: 'Cannot be formed on board' };
  }
  const points = scoreWord(upper);
  game.submissions[seat][upper] = points;
  return { valid: true, word: upper, points };
}

function endRound(game) {
  // Count word occurrences across players
  const wordCount = {};
  for (let seat = 0; seat < game.playerCount; seat++) {
    for (const word of Object.keys(game.submissions[seat] || {})) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  }

  // Recalculate scores – unique words only
  const finalScores = Array(game.playerCount).fill(0);
  const uniqueWords = Array.from({ length: game.playerCount }, () => []);

  for (let seat = 0; seat < game.playerCount; seat++) {
    for (const [word, pts] of Object.entries(game.submissions[seat] || {})) {
      if (wordCount[word] === 1) {
        finalScores[seat] += pts;
        uniqueWords[seat].push({ word, points: pts });
      }
    }
  }

  // Determine winner (highest score; tie = draw)
  let winner = -1;
  let maxScore = -1;
  let tie = false;
  for (let i = 0; i < game.playerCount; i++) {
    if (finalScores[i] > maxScore) {
      maxScore = finalScores[i];
      winner = i;
      tie = false;
    } else if (finalScores[i] === maxScore) {
      tie = true;
    }
  }

  return { finalScores, uniqueWords, winner: tie ? -1 : winner };
}

module.exports = { createGame, submitWord, endRound };
