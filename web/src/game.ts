// ─── Orb Cascade — pure game logic + rendering ────────────────────────────
// No React here. All state lives in GameState, mutated each frame.

import { drawGlow, drawText, hexToRgba, clamp, randomInRange } from "./lib/canvas";

// ─── Types ────────────────────────────────────────────────────────────────

export type Phase = "start" | "playing" | "gameover";

export interface Orb {
  id: number;
  x: number;
  y: number;
  r: number;
  color: string;
  speed: number;
  /** pulse phase for glow animation */
  phase: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  life: number; // 0–1, counts down
  decay: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  vy: number;
}

export interface GameState {
  phase: Phase;
  score: number;
  highScore: number;
  lives: number; // missed orbs remaining before game over
  combo: number;
  maxCombo: number;
  basket: {
    x: number;
    y: number;
    w: number;
    h: number;
    targetX: number;
  };
  orbs: Orb[];
  particles: Particle[];
  floatTexts: FloatText[];
  spawnTimer: number;
  spawnInterval: number;
  baseSpeed: number;
  elapsed: number;
  orbIdCounter: number;
  canvasW: number;
  canvasH: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_LIVES = 3;
const BASKET_W = 100;
const BASKET_H = 22;
const BASKET_SPEED = 520; // px/s keyboard speed
const ORB_RADIUS = 18;
const INITIAL_SPAWN_INTERVAL = 1.5; // seconds
const MIN_SPAWN_INTERVAL = 0.35;
const INITIAL_SPEED = 130; // px/s
const MAX_SPEED = 500;
const SPEED_RAMP = 18; // px/s per second of play

const ORB_COLORS = [
  "#ff6bff", // magenta
  "#6bffff", // cyan
  "#ffff6b", // yellow
  "#ff6b6b", // red
  "#6bff9f", // green
  "#ff9f6b", // orange
  "#9f6bff", // purple
  "#6bffff", // teal
];

// ─── Factory ──────────────────────────────────────────────────────────────

export function createGameState(w: number, h: number, highScore: number): GameState {
  const basketY = h - 60;
  return {
    phase: "start",
    score: 0,
    highScore,
    lives: MAX_LIVES,
    combo: 1,
    maxCombo: 1,
    basket: {
      x: w / 2,
      y: basketY,
      w: BASKET_W,
      h: BASKET_H,
      targetX: w / 2,
    },
    orbs: [],
    particles: [],
    floatTexts: [],
    spawnTimer: 0,
    spawnInterval: INITIAL_SPAWN_INTERVAL,
    baseSpeed: INITIAL_SPEED,
    elapsed: 0,
    orbIdCounter: 0,
    canvasW: w,
    canvasH: h,
  };
}

// ─── Orb spawner ──────────────────────────────────────────────────────────

function spawnOrb(state: GameState): void {
  const margin = ORB_RADIUS + 10;
  const x = randomInRange(margin, state.canvasW - margin);
  const color = ORB_COLORS[Math.floor(Math.random() * ORB_COLORS.length)]!;
  state.orbs.push({
    id: state.orbIdCounter++,
    x,
    y: -ORB_RADIUS,
    r: ORB_RADIUS,
    color,
    speed: state.baseSpeed + randomInRange(-20, 20),
    phase: Math.random() * Math.PI * 2,
  });
}

// ─── Particle burst ───────────────────────────────────────────────────────

function spawnBurst(state: GameState, x: number, y: number, color: string): void {
  const count = 18;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + randomInRange(-0.2, 0.2);
    const speed = randomInRange(60, 220);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: randomInRange(2, 6),
      color,
      life: 1,
      decay: randomInRange(1.2, 2.2),
    });
  }
}

// ─── Update ───────────────────────────────────────────────────────────────

export interface InputSnapshot {
  keys: Set<string>;
  pointerX: number | null; // null = no pointer active
}

export function update(state: GameState, dt: number, input: InputSnapshot): void {
  if (state.phase !== "playing") return;

  state.elapsed += dt;

  // Ramp difficulty
  state.baseSpeed = Math.min(INITIAL_SPEED + state.elapsed * SPEED_RAMP, MAX_SPEED);
  state.spawnInterval = Math.max(
    MIN_SPAWN_INTERVAL,
    INITIAL_SPAWN_INTERVAL - state.elapsed * 0.04,
  );

  // ── Basket movement ──────────────────────────────────────────────────
  const basket = state.basket;

  if (input.pointerX !== null) {
    basket.targetX = clamp(input.pointerX, basket.w / 2, state.canvasW - basket.w / 2);
  }
  if (input.keys.has("ArrowLeft") || input.keys.has("a") || input.keys.has("A")) {
    basket.targetX = clamp(basket.targetX - BASKET_SPEED * dt, basket.w / 2, state.canvasW - basket.w / 2);
  }
  if (input.keys.has("ArrowRight") || input.keys.has("d") || input.keys.has("D")) {
    basket.targetX = clamp(basket.targetX + BASKET_SPEED * dt, basket.w / 2, state.canvasW - basket.w / 2);
  }

  // Smooth follow
  basket.x += (basket.targetX - basket.x) * Math.min(1, dt * 14);

  // ── Spawn orbs ───────────────────────────────────────────────────────
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnOrb(state);
    state.spawnTimer = state.spawnInterval;
  }

  // ── Update orbs ──────────────────────────────────────────────────────
  const caughtIds = new Set<number>();
  const missedIds = new Set<number>();

  for (const orb of state.orbs) {
    orb.y += orb.speed * dt;
    orb.phase += dt * 3;

    // Catch detection
    const bLeft = basket.x - basket.w / 2;
    const bRight = basket.x + basket.w / 2;
    const bTop = basket.y - basket.h / 2;
    const bBottom = basket.y + basket.h / 2 + 4;

    if (
      orb.y + orb.r >= bTop &&
      orb.y - orb.r <= bBottom &&
      orb.x >= bLeft - orb.r * 0.5 &&
      orb.x <= bRight + orb.r * 0.5
    ) {
      caughtIds.add(orb.id);
    } else if (orb.y - orb.r > state.canvasH) {
      missedIds.add(orb.id);
    }
  }

  // Handle catches
  for (const orb of state.orbs) {
    if (!caughtIds.has(orb.id)) continue;
    spawnBurst(state, orb.x, orb.y, orb.color);
    const points = 10 * state.combo;
    state.score += points;
    if (state.score > state.highScore) state.highScore = state.score;
    state.combo = Math.min(state.combo + 1, 12);
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    state.floatTexts.push({
      x: orb.x,
      y: orb.y,
      text: state.combo > 1 ? `+${points} ×${state.combo}` : `+${points}`,
      life: 1,
      vy: -80,
    });
  }

  // Handle misses
  for (const orb of state.orbs) {
    if (!missedIds.has(orb.id)) continue;
    state.lives -= 1;
    state.combo = 1;
    // small shake — just record miss flash (handled in draw)
    if (state.lives <= 0) {
      state.phase = "gameover";
    }
  }

  state.orbs = state.orbs.filter((o) => !caughtIds.has(o.id) && !missedIds.has(o.id));

  // ── Particles ────────────────────────────────────────────────────────
  for (const p of state.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 160 * dt; // gravity
    p.life -= p.decay * dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);

  // ── Float texts ──────────────────────────────────────────────────────
  for (const ft of state.floatTexts) {
    ft.y += ft.vy * dt;
    ft.life -= dt * 1.4;
  }
  state.floatTexts = state.floatTexts.filter((ft) => ft.life > 0);
}

// ─── Draw helpers ─────────────────────────────────────────────────────────

function drawStarfield(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  // Static stars seeded by position — cheap
  ctx.save();
  for (let i = 0; i < 80; i++) {
    const sx = ((i * 137.508 + 11) % w);
    const sy = ((i * 97.31 + 7) % h);
    const twinkle = 0.3 + 0.4 * Math.sin(t * 1.5 + i * 0.7);
    ctx.globalAlpha = twinkle;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBasket(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
  const { x, y, w, h } = state.basket;
  const pulse = 0.7 + 0.3 * Math.sin(t * 4);

  // Outer glow
  drawGlow(ctx, x, y, w * 0.8, "#a855f7");

  // Basket body — rounded rect
  const bx = x - w / 2;
  const by = y - h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 8);
  const grad = ctx.createLinearGradient(bx, by, bx, by + h);
  grad.addColorStop(0, `rgba(168,85,247,${0.85 * pulse})`);
  grad.addColorStop(1, `rgba(99,20,180,${0.6 * pulse})`);
  ctx.fillStyle = grad;
  ctx.fill();

  // Rim highlight
  ctx.strokeStyle = `rgba(220,180,255,${0.9 * pulse})`;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "#d946ef";
  ctx.shadowBlur = 14 * pulse;
  ctx.stroke();
  ctx.restore();

  // Inner shine
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx + 6, by + 3, w - 12, h * 0.4, 4);
  ctx.fillStyle = `rgba(255,255,255,${0.12 * pulse})`;
  ctx.fill();
  ctx.restore();
}

function drawOrb(ctx: CanvasRenderingContext2D, orb: Orb): void {
  const pulse = 0.8 + 0.2 * Math.sin(orb.phase);
  const glowR = orb.r * 2.8 * pulse;

  // Outer glow
  drawGlow(ctx, orb.x, orb.y, glowR, orb.color);

  // Core
  const grad = ctx.createRadialGradient(
    orb.x - orb.r * 0.3, orb.y - orb.r * 0.3, orb.r * 0.05,
    orb.x, orb.y, orb.r,
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.35, orb.color);
  grad.addColorStop(1, hexToRgba(orb.color, 0.3));

  ctx.save();
  ctx.beginPath();
  ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.shadowColor = orb.color;
  ctx.shadowBlur = 18 * pulse;
  ctx.fill();
  ctx.restore();

  // Specular highlight
  ctx.save();
  ctx.beginPath();
  ctx.arc(orb.x - orb.r * 0.3, orb.y - orb.r * 0.3, orb.r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }
}

function drawFloatTexts(ctx: CanvasRenderingContext2D, floatTexts: FloatText[]): void {
  for (const ft of floatTexts) {
    const alpha = Math.max(0, ft.life);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawText(ctx, ft.text, ft.x, ft.y, {
      font: "bold 18px Manrope, sans-serif",
      color: "#ffffff",
      shadow: "#a855f7",
      shadowBlur: 12,
    });
    ctx.restore();
  }
}

function drawLives(ctx: CanvasRenderingContext2D, lives: number, w: number): void {
  const heartColor = "#ff6bff";
  for (let i = 0; i < MAX_LIVES; i++) {
    const filled = i < lives;
    const cx = w - 30 - i * 32;
    const cy = 28;
    ctx.save();
    ctx.font = "22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = filled ? 1 : 0.25;
    ctx.shadowColor = heartColor;
    ctx.shadowBlur = filled ? 10 : 0;
    ctx.fillText("♥", cx, cy);
    ctx.restore();
  }
}

function drawCombo(ctx: CanvasRenderingContext2D, combo: number, w: number): void {
  if (combo < 2) return;
  const text = `×${combo} COMBO`;
  const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 150);
  ctx.save();
  ctx.globalAlpha = pulse;
  drawText(ctx, text, w / 2, 52, {
    font: `bold ${14 + combo}px Manrope, sans-serif`,
    color: "#ffff6b",
    shadow: "#ff9f00",
    shadowBlur: 16,
  });
  ctx.restore();
}

// ─── Overlay screens ──────────────────────────────────────────────────────

function drawStartScreen(ctx: CanvasRenderingContext2D, w: number, h: number, highScore: number, t: number): void {
  // Dim overlay
  ctx.save();
  ctx.fillStyle = "rgba(10,0,26,0.72)";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Title
  const titleY = h * 0.34;
  const pulse = 0.92 + 0.08 * Math.sin(t * 2.2);
  ctx.save();
  ctx.globalAlpha = pulse;
  drawText(ctx, "ORB CASCADE", w / 2, titleY, {
    font: "bold 52px Fraunces, serif",
    color: "#d946ef",
    shadow: "#a855f7",
    shadowBlur: 36,
  });
  ctx.restore();

  drawText(ctx, "Catch the falling orbs!", w / 2, titleY + 62, {
    font: "500 18px Manrope, sans-serif",
    color: "#e2d9f3",
  });

  if (highScore > 0) {
    drawText(ctx, `Best: ${highScore}`, w / 2, titleY + 96, {
      font: "600 16px Manrope, sans-serif",
      color: "#a855f7",
      shadow: "#d946ef",
      shadowBlur: 8,
    });
  }

  // Instructions
  const instrY = h * 0.62;
  drawText(ctx, "Move: Mouse / Touch / Arrow Keys", w / 2, instrY, {
    font: "500 15px Manrope, sans-serif",
    color: "#c4b5d4",
  });
  drawText(ctx, "Miss 3 orbs → Game Over", w / 2, instrY + 28, {
    font: "500 15px Manrope, sans-serif",
    color: "#c4b5d4",
  });

  // Pulsing CTA button
  const btnW = 220;
  const btnH = 52;
  const btnX = w / 2 - btnW / 2;
  const btnY = h * 0.74;
  const btnPulse = 0.88 + 0.12 * Math.sin(t * 2.8);

  ctx.save();
  ctx.globalAlpha = btnPulse;
  ctx.beginPath();
  ctx.roundRect(btnX, btnY, btnW, btnH, 26);
  const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
  grad.addColorStop(0, "#a855f7");
  grad.addColorStop(1, "#d946ef");
  ctx.fillStyle = grad;
  ctx.shadowColor = "#d946ef";
  ctx.shadowBlur = 28;
  ctx.fill();
  ctx.restore();

  drawText(ctx, "TAP TO PLAY", w / 2, btnY + btnH / 2, {
    font: "bold 20px Manrope, sans-serif",
    color: "#ffffff",
    shadow: "#ffffff",
    shadowBlur: 6,
  });
}

function drawGameOverScreen(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
  const { canvasW: w, canvasH: h, score, highScore, maxCombo } = state;

  ctx.save();
  ctx.fillStyle = "rgba(10,0,26,0.82)";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const cy = h * 0.32;
  drawText(ctx, "GAME OVER", w / 2, cy, {
    font: "bold 52px Fraunces, serif",
    color: "#ff6b6b",
    shadow: "#ff0050",
    shadowBlur: 36,
  });

  drawText(ctx, `Score: ${score}`, w / 2, cy + 70, {
    font: "bold 28px Manrope, sans-serif",
    color: "#ffffff",
    shadow: "#a855f7",
    shadowBlur: 12,
  });

  if (score >= highScore && score > 0) {
    const hsPulse = 0.85 + 0.15 * Math.sin(t * 3);
    ctx.save();
    ctx.globalAlpha = hsPulse;
    drawText(ctx, "✦ NEW HIGH SCORE ✦", w / 2, cy + 110, {
      font: "bold 18px Manrope, sans-serif",
      color: "#ffff6b",
      shadow: "#ff9f00",
      shadowBlur: 18,
    });
    ctx.restore();
  } else if (highScore > 0) {
    drawText(ctx, `Best: ${highScore}`, w / 2, cy + 110, {
      font: "600 16px Manrope, sans-serif",
      color: "#a855f7",
    });
  }

  drawText(ctx, `Max Combo: ×${maxCombo}`, w / 2, cy + 148, {
    font: "500 15px Manrope, sans-serif",
    color: "#c4b5d4",
  });

  // Restart button
  const btnW = 220;
  const btnH = 52;
  const btnX = w / 2 - btnW / 2;
  const btnY = h * 0.68;
  const btnPulse = 0.88 + 0.12 * Math.sin(t * 2.8);

  ctx.save();
  ctx.globalAlpha = btnPulse;
  ctx.beginPath();
  ctx.roundRect(btnX, btnY, btnW, btnH, 26);
  const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
  grad.addColorStop(0, "#a855f7");
  grad.addColorStop(1, "#d946ef");
  ctx.fillStyle = grad;
  ctx.shadowColor = "#d946ef";
  ctx.shadowBlur = 28;
  ctx.fill();
  ctx.restore();

  drawText(ctx, "PLAY AGAIN", w / 2, btnY + btnH / 2, {
    font: "bold 20px Manrope, sans-serif",
    color: "#ffffff",
    shadow: "#ffffff",
    shadowBlur: 6,
  });
}

function drawHUD(ctx: CanvasRenderingContext2D, state: GameState): void {
  const { canvasW: w, score, combo } = state;
  drawText(ctx, `${score}`, w / 2, 24, {
    font: "bold 26px Manrope, sans-serif",
    color: "#ffffff",
    shadow: "#a855f7",
    shadowBlur: 12,
  });
  drawLives(ctx, state.lives, w);
  drawCombo(ctx, combo, w);
}

// ─── Master draw ──────────────────────────────────────────────────────────

export function draw(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  t: number,
): void {
  const { canvasW: w, canvasH: h } = state;

  // Background
  ctx.fillStyle = "#0a001a";
  ctx.fillRect(0, 0, w, h);

  drawStarfield(ctx, w, h, t);

  if (state.phase === "start") {
    // Draw a couple demo orbs slowly drifting for the start screen
    drawStartScreen(ctx, w, h, state.highScore, t);
    return;
  }

  // Playing / game-over — draw world
  drawParticles(ctx, state.particles);

  for (const orb of state.orbs) {
    drawOrb(ctx, orb);
  }

  drawBasket(ctx, state, t);
  drawFloatTexts(ctx, state.floatTexts);
  drawHUD(ctx, state);

  if (state.phase === "gameover") {
    drawGameOverScreen(ctx, state, t);
  }
}
