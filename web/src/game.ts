// ─── Orb Cascade – pure game logic (no React, no DOM) ───────────────────────
// All state lives here; App.tsx owns the canvas + hooks.

import { randomInRange, randomColor, clamp } from "./lib/canvas";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Orb {
  id: number;
  x: number;
  y: number;
  vy: number;         // pixels per second
  radius: number;
  color: string;
  glow: number;       // glow pulse phase (radians)
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  life: number;       // remaining life 0-1
}

export type Phase = "start" | "playing" | "gameover";

export interface GameState {
  phase: Phase;
  score: number;
  highScore: number;
  combo: number;
  maxCombo: number;
  misses: number;
  maxMisses: number;
  basketX: number;
  basketW: number;
  basketH: number;
  orbs: Orb[];
  particles: Particle[];
  spawnTimer: number;
  spawnInterval: number;  // seconds between spawns
  baseSpeed: number;      // pixels/sec for orbs
  elapsed: number;        // seconds since game start
  comboFlash: number;     // countdown timer for combo text flash
  missFlash: number;      // countdown for miss flash
  catchFlash: number;     // countdown for catch flash
  lastCatchScore: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_MISSES = 3;
const BASKET_W = 110;
const BASKET_H = 22;
const ORB_RADIUS_MIN = 14;
const ORB_RADIUS_MAX = 26;
const BASE_SPEED = 180;
const SPAWN_INTERVAL_START = 1.5;
const SPAWN_INTERVAL_MIN = 0.45;
const BASKET_SPEED = 520; // px/sec via keyboard

let _nextId = 1;

// ── Factory ──────────────────────────────────────────────────────────────────

export function createGameState(highScore: number, canvasW: number, canvasH: number): GameState {
  return {
    phase: "start",
    score: 0,
    highScore,
    combo: 0,
    maxCombo: 0,
    misses: 0,
    maxMisses: MAX_MISSES,
    basketX: canvasW / 2,
    basketW: BASKET_W,
    basketH: BASKET_H,
    orbs: [],
    particles: [],
    spawnTimer: 0,
    spawnInterval: SPAWN_INTERVAL_START,
    baseSpeed: BASE_SPEED,
    elapsed: 0,
    comboFlash: 0,
    missFlash: 0,
    catchFlash: 0,
    lastCatchScore: 0,
  };
}

// ── Spawn ────────────────────────────────────────────────────────────────────

function spawnOrb(state: GameState, canvasW: number): void {
  const r = randomInRange(ORB_RADIUS_MIN, ORB_RADIUS_MAX);
  const speed = state.baseSpeed + randomInRange(0, 60);
  state.orbs.push({
    id: _nextId++,
    x: randomInRange(r + 10, canvasW - r - 10),
    y: -r,
    vy: speed,
    radius: r,
    color: randomColor(),
    glow: Math.random() * Math.PI * 2,
  });
}

// ── Particles ────────────────────────────────────────────────────────────────

function burstParticles(state: GameState, x: number, y: number, color: string, count = 18): void {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + randomInRange(-0.3, 0.3);
    const speed = randomInRange(80, 260);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: randomInRange(3, 7),
      color,
      alpha: 1,
      life: 1,
    });
  }
}

// ── Main update ──────────────────────────────────────────────────────────────

export function updateGame(
  state: GameState,
  dt: number,
  canvasW: number,
  canvasH: number,
  inputX: number | null,   // null = no pointer, number = target basket centre X
  leftHeld: boolean,
  rightHeld: boolean,
): GameState {
  if (state.phase !== "playing") return state;

  // Clone top-level (shallow – arrays are mutated in place for perf)
  const s = { ...state };
  s.elapsed += dt;

  // ── Basket movement ──────────────────────────────────────────────────────
  const halfW = s.basketW / 2;

  if (inputX !== null) {
    // Pointer / touch: snap with lerp for smoothness
    s.basketX = clamp(
      s.basketX + (inputX - s.basketX) * Math.min(1, dt * 14),
      halfW,
      canvasW - halfW,
    );
  } else {
    if (leftHeld)  s.basketX = clamp(s.basketX - BASKET_SPEED * dt, halfW, canvasW - halfW);
    if (rightHeld) s.basketX = clamp(s.basketX + BASKET_SPEED * dt, halfW, canvasW - halfW);
  }

  // ── Difficulty ramp ──────────────────────────────────────────────────────
  s.baseSpeed = BASE_SPEED + s.elapsed * 14;
  s.spawnInterval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - s.elapsed * 0.04);

  // ── Spawn ────────────────────────────────────────────────────────────────
  s.spawnTimer -= dt;
  if (s.spawnTimer <= 0) {
    spawnOrb(s, canvasW);
    s.spawnTimer = s.spawnInterval + randomInRange(-0.1, 0.1);
  }

  // ── Orb update ───────────────────────────────────────────────────────────
  const basketTop = canvasH - 60 - s.basketH;
  const basketBottom = canvasH - 60;

  const survivingOrbs: Orb[] = [];
  let newMisses = s.misses;
  let newScore = s.score;
  let newCombo = s.combo;

  for (const orb of s.orbs) {
    orb.y += orb.vy * dt;
    orb.glow += dt * 3;

    // Catch check: orb centre inside basket zone
    const caught =
      orb.y + orb.radius >= basketTop &&
      orb.y - orb.radius <= basketBottom &&
      orb.x >= s.basketX - halfW - orb.radius * 0.5 &&
      orb.x <= s.basketX + halfW + orb.radius * 0.5;

    if (caught) {
      newCombo += 1;
      const points = 10 * newCombo;
      newScore += points;
      s.lastCatchScore = points;
      s.catchFlash = 0.6;
      if (newCombo > 1) s.comboFlash = 0.9;
      burstParticles(s, orb.x, orb.y, orb.color);
      continue; // remove orb
    }

    // Miss check
    if (orb.y - orb.radius > canvasH) {
      newMisses += 1;
      newCombo = 0;
      s.missFlash = 0.5;
      // small red burst at bottom
      burstParticles(s, orb.x, canvasH - 20, "#ff4757", 8);
      continue; // remove orb
    }

    survivingOrbs.push(orb);
  }

  s.orbs = survivingOrbs;
  s.score = newScore;
  s.combo = newCombo;
  s.maxCombo = Math.max(s.maxCombo, newCombo);
  s.misses = newMisses;

  // ── Particles update ─────────────────────────────────────────────────────
  const survivingParticles: Particle[] = [];
  for (const p of s.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 320 * dt; // gravity
    p.life -= dt * 1.8;
    p.alpha = Math.max(0, p.life);
    if (p.life > 0) survivingParticles.push(p);
  }
  s.particles = survivingParticles;

  // ── Flash timers ─────────────────────────────────────────────────────────
  s.comboFlash  = Math.max(0, s.comboFlash  - dt);
  s.missFlash   = Math.max(0, s.missFlash   - dt);
  s.catchFlash  = Math.max(0, s.catchFlash  - dt);

  // ── Game over ────────────────────────────────────────────────────────────
  if (s.misses >= MAX_MISSES) {
    s.phase = "gameover";
    s.highScore = Math.max(s.highScore, s.score);
  }

  return s;
}

// ── Helpers for App ──────────────────────────────────────────────────────────

export function startGame(state: GameState, canvasW: number, canvasH: number): GameState {
  const fresh = createGameState(state.highScore, canvasW, canvasH);
  fresh.phase = "playing";
  fresh.spawnTimer = 0.3;
  return fresh;
}
