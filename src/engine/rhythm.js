'use strict';

const BPM = 120;
const BEAT_INTERVAL = Math.round(60000 / BPM); // 500 ms per beat
const ROUND_DURATION = 60000; // 60 seconds
const COUNTDOWN = 3000; // 3-second countdown before beats start

/**
 * Generate a beat sequence for a 60-second round.
 * Returns an array of { id, time } where time is ms from round start.
 */
function generateBeats() {
  const beats = [];
  let time = COUNTDOWN;
  let id = 0;

  // Pattern options: gaps between beats (ms)
  const PATTERNS = [
    BEAT_INTERVAL,       // quarter note  (500ms)
    BEAT_INTERVAL,       // quarter note  (500ms) – weighted
    BEAT_INTERVAL,       // quarter note  (500ms) – weighted
    BEAT_INTERVAL * 2,   // half note     (1000ms)
    BEAT_INTERVAL / 2,   // eighth note   (250ms) part A
    BEAT_INTERVAL / 2,   // eighth note   (250ms) part B (consecutive)
    BEAT_INTERVAL * 1.5, // dotted quarter (750ms)
  ];

  while (time < ROUND_DURATION - 500) {
    beats.push({ id: id++, time });
    const gap = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
    time += gap;
  }

  return beats;
}

/**
 * Timing windows for scoring a tap.
 * @param {number} offset – ms between tap and beat (absolute value)
 */
function scoreTap(offset) {
  if (offset <= 50)  return { grade: 'PERFECT', points: 3 };
  if (offset <= 120) return { grade: 'GREAT',   points: 2 };
  if (offset <= 220) return { grade: 'OK',      points: 1 };
  return { grade: 'MISS', points: 0 };
}

function createGame(playerCount) {
  const beats = generateBeats();
  return {
    beats,
    playerCount,
    roundDuration: ROUND_DURATION,
    bpm: BPM,
    countdown: COUNTDOWN,
    /** seat -> { totalScore, perfect, great, ok, miss } */
    scores: {}
  };
}

/**
 * Record a player's final score summary (sent client-side at round end).
 */
function setScore(game, seat, scoreData) {
  game.scores[seat] = scoreData;
}

/**
 * Returns winner and all scores once every player has submitted.
 */
function getResults(game) {
  let winner = null;
  let maxScore = -1;
  let tie = false;

  for (const [seat, data] of Object.entries(game.scores)) {
    const s = data.totalScore || 0;
    if (s > maxScore) {
      maxScore = s;
      winner = seat;
      tie = false;
    } else if (s === maxScore) {
      tie = true;
    }
  }

  return { scores: game.scores, winner: tie ? null : winner };
}

module.exports = { createGame, setScore, getResults, scoreTap, ROUND_DURATION, COUNTDOWN };
