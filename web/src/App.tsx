import { useRef, useEffect, useCallback, useState } from "react";
import { GameShell, GameTopbar } from "@freegamestore/games";
import { useGameLoop } from "./hooks/useGameLoop";
import { useHighScore } from "./hooks/useHighScore";
import { useControls } from "./hooks/useControls";
import {
  drawGlow,
  drawText,
  clamp,
  randomInRange,
  randomColor,
  lerp,
} from "./lib/canvas";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "start" | "playing" | "gameover";

interface Orb {
  id: number;
  x: number;
  y: number;
  vy: number;
  radius: number;
  color: string;
  glow: number; // glow pulse phase
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0–1
  color: string;
  radius: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASKET_W = 90;
const BASKET_H = 28;
const BASKET_SPEED = 520; // px/s keyboard speed
const MAX_MISSES = 3;
const ORB_RADIUS = 18;
const SPAWN_INTERVAL_BASE = 1.4; // seconds between orbs at start
const SPAWN_INTERVAL_MIN = 0.38;
const SPEED_BASE = 200;
const SPEED_MAX = 560;
const NEON_COLORS = [
  "#ff3cac", "#ff6b6b", "#ffdd57", "#3cefff",
  "#a855f7", "#22d3ee", "#4ade80", "#f97316",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function spawnOrb(id: number, w: number, elapsed: number): Orb {
  const t = Math.min(elapsed / 90, 1); // ramp over 90 seconds
  const speed = lerp(SPEED_BASE, SPEED_MAX, t);
  const color = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)] ?? "#ff3cac";
  return {
    id,
    x: randomInRange(ORB_RADIUS + 10, w - ORB_RADIUS - 10),
    y: -ORB_RADIUS,
    vy: speed + randomInRange(-30, 30),
    radius: ORB_RADIUS + randomInRange(-4, 6),
    color,
    glow: Math.random() * Math.PI * 2,
  };
}

function spawnBurst(particles: Particle[], x: number, y: number, color: string) {
  for (let i = 0; i < 22; i++) {
    const angle = (Math.PI * 2 * i) / 22 + randomInRange(-0.2, 0.2);
    const speed = randomInRange(60, 220);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color,
      radius: randomInRange(2.5, 6),
    });
  }
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function drawBasket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  combo: number,
) {
  const glowColor = combo >= 5 ? "#ffdd57" : combo >= 3 ? "#a855f7" : "#3cefff";
  const glowR = w * 0.9 + combo * 4;

  // Outer glow
  drawGlow(ctx, x, y + h / 2, glowR, glowColor);

  // Basket rim
  ctx.save();
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 3.5;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x - w / 2 + 8, y + h);
  ctx.lineTo(x + w / 2 - 8, y + h);
  ctx.lineTo(x + w / 2, y);
  ctx.stroke();

  // Basket opening (top arc)
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.bezierCurveTo(
    x - w / 4, y - 10,
    x + w / 4, y - 10,
    x + w / 2, y,
  );
  ctx.stroke();

  // Net lines
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 6;
  const netSegs = 5;
  for (let i = 0; i <= netSegs; i++) {
    const tx = (x - w / 2 + 8) + ((w - 16) / netSegs) * i;
    const bx = (x - w / 2 + 8) + ((w - 16) / netSegs) * i;
    ctx.beginPath();
    ctx.moveTo(tx, y);
    ctx.lineTo(bx + (i % 2 === 0 ? 4 : -4), y + h);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOrbEntity(ctx: CanvasRenderingContext2D, orb: Orb, t: number) {
  const pulse = 1 + 0.12 * Math.sin(orb.glow + t * 3);
  const r = orb.radius * pulse;

  // Outer glow
  drawGlow(ctx, orb.x, orb.y, r * 2.8, orb.color);

  // Orb body
  ctx.save();
  const grad = ctx.createRadialGradient(
    orb.x - r * 0.3, orb.y - r * 0.3, r * 0.05,
    orb.x, orb.y, r,
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.35, orb.color);
  grad.addColorStop(1, orb.color + "44");
  ctx.beginPath();
  ctx.arc(orb.x, orb.y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.shadowColor = orb.color;
  ctx.shadowBlur = 22;
  ctx.fill();
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();
  }
}

function drawFloatTexts(ctx: CanvasRenderingContext2D, floats: FloatText[]) {
  for (const f of floats) {
    ctx.save();
    ctx.globalAlpha = f.life;
    drawText(ctx, f.text, f.x, f.y, {
      font: `bold ${Math.round(18 + (1 - f.life) * 8)}px Manrope, sans-serif`,
      color: f.color,
      shadow: f.color,
      shadowBlur: 16,
    });
    ctx.restore();
  }
}

function drawMissIndicators(ctx: CanvasRenderingContext2D, misses: number, cx: number, y: number) {
  const spacing = 28;
  const total = MAX_MISSES;
  const startX = cx - ((total - 1) * spacing) / 2;
  for (let i = 0; i < total; i++) {
    const filled = i < misses;
    ctx.save();
    ctx.beginPath();
    ctx.arc(startX + i * spacing, y, 9, 0, Math.PI * 2);
    if (filled) {
      ctx.fillStyle = "#ff3cac";
      ctx.shadowColor = "#ff3cac";
      ctx.shadowBlur = 14;
      ctx.fill();
    } else {
      ctx.strokeStyle = "#ff3cac44";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ─── Overlay screens (drawn on canvas) ────────────────────────────────────────

function drawStartScreen(ctx: CanvasRenderingContext2D, w: number, h: number, highScore: number) {
  // Dark overlay
  ctx.fillStyle = "rgba(10,0,28,0.88)";
  ctx.fillRect(0, 0, w, h);

  // Title
  drawText(ctx, "ORB CASCADE", w / 2, h / 2 - 110, {
    font: "bold 52px Fraunces, serif",
    color: "#3cefff",
    shadow: "#3cefff",
    shadowBlur: 32,
  });

  // Subtitle
  drawText(ctx, "Catch the falling orbs!", w / 2, h / 2 - 58, {
    font: "22px Manrope, sans-serif",
    color: "#a855f7",
    shadow: "#a855f7",
    shadowBlur: 14,
  });

  // Instructions
  const lines = [
    "🖱  Move mouse / drag to steer basket",
    "⌨  Arrow keys also work",
    "💀  Miss 3 orbs = Game Over",
    "🔥  Catch streaks = Combo multiplier",
  ];
  lines.forEach((line, i) => {
    drawText(ctx, line, w / 2, h / 2 + 10 + i * 36, {
      font: "16px Manrope, sans-serif",
      color: "#e2e8f0",
    });
  });

  // High score
  if (highScore > 0) {
    drawText(ctx, `Best: ${highScore}`, w / 2, h / 2 + 168, {
      font: "bold 20px Manrope, sans-serif",
      color: "#ffdd57",
      shadow: "#ffdd57",
      shadowBlur: 12,
    });
  }

  // Start button
  const btnY = h / 2 + 215;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(w / 2 - 100, btnY - 26, 200, 52, 26);
  ctx.fillStyle = "#3cefff22";
  ctx.strokeStyle = "#3cefff";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "#3cefff";
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawText(ctx, "TAP TO PLAY", w / 2, btnY, {
    font: "bold 22px Manrope, sans-serif",
    color: "#3cefff",
    shadow: "#3cefff",
    shadowBlur: 20,
  });
}

function drawGameOverScreen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  score: number,
  highScore: number,
) {
  ctx.fillStyle = "rgba(10,0,28,0.88)";
  ctx.fillRect(0, 0, w, h);

  drawText(ctx, "GAME OVER", w / 2, h / 2 - 110, {
    font: "bold 52px Fraunces, serif",
    color: "#ff3cac",
    shadow: "#ff3cac",
    shadowBlur: 36,
  });

  drawText(ctx, `Score: ${score}`, w / 2, h / 2 - 48, {
    font: "bold 34px Manrope, sans-serif",
    color: "#ffffff",
    shadow: "#ffffff",
    shadowBlur: 10,
  });

  const isNewBest = score > 0 && score >= highScore;
  if (isNewBest) {
    drawText(ctx, "🏆 NEW BEST!", w / 2, h / 2 + 2, {
      font: "bold 24px Manrope, sans-serif",
      color: "#ffdd57",
      shadow: "#ffdd57",
      shadowBlur: 18,
    });
  } else if (highScore > 0) {
    drawText(ctx, `Best: ${highScore}`, w / 2, h / 2 + 2, {
      font: "20px Manrope, sans-serif",
      color: "#a855f7",
      shadow: "#a855f7",
      shadowBlur: 10,
    });
  }

  // Restart button
  const btnY = h / 2 + 100;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(w / 2 - 110, btnY - 28, 220, 56, 28);
  ctx.fillStyle = "#ff3cac22";
  ctx.strokeStyle = "#ff3cac";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "#ff3cac";
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawText(ctx, "PLAY AGAIN", w / 2, btnY, {
    font: "bold 24px Manrope, sans-serif",
    color: "#ff3cac",
    shadow: "#ff3cac",
    shadowBlur: 20,
  });
}

// ─── Background starfield ─────────────────────────────────────────────────────

interface Star {
  x: number; y: number; r: number; twinkle: number; color: string;
}
function makeStars(w: number, h: number, n = 80): Star[] {
  return Array.from({ length: n }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: randomInRange(0.5, 2.2),
    twinkle: Math.random() * Math.PI * 2,
    color: NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)] ?? "#fff",
  }));
}
function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, stars: Star[], t: number) {
  // Deep space gradient
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0a001c");
  bg.addColorStop(1, "#12003a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Stars
  for (const s of stars) {
    const alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(s.twinkle + t * 1.4));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Game state (all in refs to avoid re-renders inside the loop)
  const phaseRef = useRef<Phase>("start");
  const [phase, setPhase] = useState<Phase>("start");
  const [score, setScore] = useState(0);
  const [highScore, updateHighScore] = useHighScore("orbcascade_highscore");

  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const missesRef = useRef(0);
  const elapsedRef = useRef(0);
  const spawnTimerRef = useRef(0);
  const orbIdRef = useRef(0);
  const orbsRef = useRef<Orb[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const floatsRef = useRef<FloatText[]>([]);
  const starsRef = useRef<Star[]>([]);
  const timeRef = useRef(0);

  // Basket position
  const basketXRef = useRef(0);
  const targetXRef = useRef(0);

  const controls = useControls();

  // Canvas sizing
  const sizeRef = useRef({ w: 0, h: 0 });
  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      sizeRef.current = { w: rect.width, h: rect.height };
      basketXRef.current = rect.width / 2;
      targetXRef.current = rect.width / 2;
      starsRef.current = makeStars(rect.width, rect.height);
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Reset / start game
  const startGame = useCallback(() => {
    const { w } = sizeRef.current;
    scoreRef.current = 0;
    comboRef.current = 0;
    missesRef.current = 0;
    elapsedRef.current = 0;
    spawnTimerRef.current = 0;
    orbIdRef.current = 0;
    orbsRef.current = [];
    particlesRef.current = [];
    floatsRef.current = [];
    basketXRef.current = w / 2;
    targetXRef.current = w / 2;
    setScore(0);
    phaseRef.current = "playing";
    setPhase("playing");
  }, []);

  // Handle tap/click — start or restart
  const handleCanvasClick = useCallback(() => {
    if (phaseRef.current === "start" || phaseRef.current === "gameover") {
      startGame();
    }
  }, [startGame]);

  // Game loop
  const tick = useCallback(
    (dt: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) return;

      timeRef.current += dt;
      const t = timeRef.current;

      // ── Input → basket target ──
      const { keys, mouse, touch } = controls;
      if (touch.active) {
        targetXRef.current = touch.x;
      } else if (mouse.x > 0) {
        targetXRef.current = mouse.x;
      }
      if (keys.has("ArrowLeft")) targetXRef.current -= BASKET_SPEED * dt;
      if (keys.has("ArrowRight")) targetXRef.current += BASKET_SPEED * dt;
      targetXRef.current = clamp(targetXRef.current, BASKET_W / 2, w - BASKET_W / 2);

      // Smooth basket movement
      basketXRef.current = lerp(basketXRef.current, targetXRef.current, Math.min(1, dt * 14));

      // ── Draw background ──
      drawBackground(ctx, w, h, starsRef.current, t);

      if (phaseRef.current === "playing") {
        elapsedRef.current += dt;
        const elapsed = elapsedRef.current;

        // Spawn interval ramps down over time
        const tRamp = Math.min(elapsed / 90, 1);
        const spawnInterval = lerp(SPAWN_INTERVAL_BASE, SPAWN_INTERVAL_MIN, tRamp);

        // ── Spawn orbs ──
        spawnTimerRef.current -= dt;
        if (spawnTimerRef.current <= 0) {
          orbsRef.current.push(spawnOrb(orbIdRef.current++, w, elapsed));
          spawnTimerRef.current = spawnInterval * randomInRange(0.8, 1.2);
        }

        // ── Update orbs ──
        const basketY = h - 60;
        const newOrbs: Orb[] = [];
        for (const orb of orbsRef.current) {
          orb.y += orb.vy * dt;
          orb.glow += dt;

          // Catch check
          const bx = basketXRef.current;
          const halfW = BASKET_W / 2;
          if (
            orb.y + orb.radius >= basketY - BASKET_H / 2 &&
            orb.y - orb.radius <= basketY + BASKET_H / 2 &&
            orb.x >= bx - halfW - orb.radius &&
            orb.x <= bx + halfW + orb.radius
          ) {
            // Caught!
            comboRef.current += 1;
            const combo = comboRef.current;
            const multiplier = combo >= 8 ? 5 : combo >= 5 ? 3 : combo >= 3 ? 2 : 1;
            const pts = 10 * multiplier;
            scoreRef.current += pts;
            setScore(scoreRef.current);
            spawnBurst(particlesRef.current, orb.x, orb.y, orb.color);
            const label = multiplier > 1 ? `+${pts} ×${multiplier}` : `+${pts}`;
            floatsRef.current.push({
              x: orb.x, y: orb.y - 20, vy: -60,
              life: 1, text: label,
              color: multiplier >= 3 ? "#ffdd57" : multiplier === 2 ? "#a855f7" : orb.color,
            });
            continue; // remove from array
          }

          // Miss check
          if (orb.y - orb.radius > h) {
            missesRef.current += 1;
            comboRef.current = 0;
            if (missesRef.current >= MAX_MISSES) {
              updateHighScore(scoreRef.current);
              phaseRef.current = "gameover";
              setPhase("gameover");
            }
            continue;
          }

          newOrbs.push(orb);
        }
        orbsRef.current = newOrbs;

        // ── Update particles ──
        particlesRef.current = particlesRef.current.filter((p) => {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 180 * dt; // gravity
          p.life -= dt * 1.8;
          return p.life > 0;
        });

        // ── Update float texts ──
        floatsRef.current = floatsRef.current.filter((f) => {
          f.y += f.vy * dt;
          f.life -= dt * 1.4;
          return f.life > 0;
        });

        // ── Draw orbs ──
        for (const orb of orbsRef.current) drawOrbEntity(ctx, orb, t);

        // ── Draw particles ──
        drawParticles(ctx, particlesRef.current);

        // ── Draw float texts ──
        drawFloatTexts(ctx, floatsRef.current);

        // ── Draw basket ──
        const basketY2 = h - 60;
        drawBasket(ctx, basketXRef.current, basketY2 - BASKET_H / 2, BASKET_W, BASKET_H, comboRef.current);

        // ── HUD: score ──
        drawText(ctx, `${scoreRef.current}`, w / 2, 36, {
          font: "bold 32px Manrope, sans-serif",
          color: "#ffffff",
          shadow: "#3cefff",
          shadowBlur: 16,
        });

        // ── HUD: combo ──
        if (comboRef.current >= 2) {
          const comboColor = comboRef.current >= 8 ? "#ffdd57" : comboRef.current >= 5 ? "#a855f7" : "#ff3cac";
          drawText(ctx, `×${comboRef.current} COMBO`, w / 2, 72, {
            font: "bold 18px Manrope, sans-serif",
            color: comboColor,
            shadow: comboColor,
            shadowBlur: 14,
          });
        }

        // ── HUD: misses ──
        drawMissIndicators(ctx, missesRef.current, w / 2, h - 18);

      } else if (phaseRef.current === "start") {
        // Animate some orbs in background on start screen
        drawStartScreen(ctx, w, h, highScore);
      } else if (phaseRef.current === "gameover") {
        // Draw remaining particles
        drawParticles(ctx, particlesRef.current);
        drawGameOverScreen(ctx, w, h, scoreRef.current, highScore);
      }
    },
    [controls, highScore, updateHighScore],
  );

  useGameLoop(tick);

  return (
    <GameShell topbar={<GameTopbar title="Orb Cascade" score={score} />}>
      <div
        ref={containerRef}
        className="relative w-full h-full overflow-hidden"
        style={{ background: "#0a001c" }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: "none", cursor: "none" }}
          onClick={handleCanvasClick}
          onTouchStart={handleCanvasClick}
        />
      </div>
    </GameShell>
  );
}
