import { useEffect, useRef } from 'react';

interface Drop {
  x: number;
  y: number;
  r: number;
  speed: number;
  seed: number;
  sliding: boolean;
  trail: number;
  opacity: number;
}

interface Streak {
  x: number;
  y: number;
  length: number;
  speed: number;
  wind: number;
  alpha: number;
}

/** Rain streaks with droplets sliding down an implied glass pane. */
export function RainEffect({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const light = tone === 'light';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let drops: Drop[] = [];
    let streaks: Streak[] = [];

    const randomDrop = () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 1.2 + Math.random() * 3.4,
      speed: 18 + Math.random() * 62,
      seed: Math.random() * Math.PI * 2,
      sliding: Math.random() < 0.22,
      trail: 8 + Math.random() * 90,
      opacity: 0.2 + Math.random() * 0.42,
    });

    const setup = () => {
      const area = width * height;
      const count = Math.min(150, Math.max(40, Math.round(area / 16000)));
      drops = Array.from({ length: count }, randomDrop);
      streaks = Array.from(
        { length: Math.min(210, Math.max(60, Math.round(area / 11000))) },
        () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          length: 10 + Math.random() * 42,
          speed: 420 + Math.random() * 520,
          wind: -20 + Math.random() * 40,
          alpha: 0.06 + Math.random() * 0.16,
        }),
      );
    };

    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setup();
      if (reduced) render(0, true);
    };

    const render = (time: number, once = false) => {
      const dt = Math.min(0.05, last ? (time - last) / 1000 : 0.016);
      last = time;
      ctx.clearRect(0, 0, width, height);

      // Cold glass wash.
      const wash = ctx.createLinearGradient(0, 0, 0, height);
      if (light) {
        wash.addColorStop(0, 'rgba(255,255,255,0.30)');
        wash.addColorStop(0.55, 'rgba(255,255,255,0.06)');
        wash.addColorStop(1, 'rgba(200,218,235,0.26)');
      } else {
        wash.addColorStop(0, 'rgba(10,22,40,0.34)');
        wash.addColorStop(0.55, 'rgba(10,20,38,0.08)');
        wash.addColorStop(1, 'rgba(4,10,20,0.32)');
      }
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);

      // Falling rain.
      ctx.lineCap = 'round';
      for (const streak of streaks) {
        if (!once) {
          streak.y += streak.speed * dt;
          streak.x += streak.wind * dt;
          if (streak.y > height + 40) {
            streak.y = -40 - Math.random() * 80;
            streak.x = Math.random() * width;
          }
          if (streak.x < -30) streak.x = width + 20;
          if (streak.x > width + 30) streak.x = -20;
        }
        ctx.strokeStyle = light
          ? `rgba(92,124,164,${streak.alpha * 1.15})`
          : `rgba(188,216,255,${streak.alpha})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(streak.x, streak.y);
        ctx.lineTo(
          streak.x - (streak.wind / streak.speed) * streak.length,
          streak.y - streak.length,
        );
        ctx.stroke();
      }

      // Droplets on the glass.
      for (const drop of drops) {
        if (drop.sliding && !once) {
          drop.y += drop.speed * dt;
          drop.x += Math.sin(drop.y * 0.018 + drop.seed) * 0.45;
          drop.trail = Math.min(150, drop.trail + drop.speed * dt * 0.6);
          if (drop.y > height + 16) {
            Object.assign(drop, randomDrop(), { y: -10, sliding: false, trail: 8 });
          }
        } else if (!once && Math.random() < 0.00045) {
          drop.sliding = true;
        }

        if (drop.trail > 10) {
          const trail = ctx.createLinearGradient(
            drop.x,
            drop.y - drop.trail,
            drop.x,
            drop.y,
          );
          trail.addColorStop(0, light ? 'rgba(86,112,150,0)' : 'rgba(200,226,255,0)');
          trail.addColorStop(
            1,
            light
              ? `rgba(86,112,150,${drop.opacity * 0.55})`
              : `rgba(200,226,255,${drop.opacity * 0.5})`,
          );
          ctx.strokeStyle = trail;
          ctx.lineWidth = Math.max(0.7, drop.r * 0.45);
          ctx.beginPath();
          ctx.moveTo(drop.x, drop.y - drop.trail);
          ctx.lineTo(drop.x, drop.y - drop.r * 0.4);
          ctx.stroke();
        }

        const glow = ctx.createRadialGradient(
          drop.x - drop.r * 0.3,
          drop.y - drop.r * 0.4,
          0,
          drop.x,
          drop.y,
          drop.r * 1.8,
        );
        glow.addColorStop(0, `rgba(255,255,255,${drop.opacity * 1.1})`);
        glow.addColorStop(
          0.35,
          light
            ? `rgba(88,116,158,${drop.opacity * 0.55})`
            : `rgba(205,228,255,${drop.opacity * 0.55})`,
        );
        glow.addColorStop(1, light ? 'rgba(88,116,158,0)' : 'rgba(160,200,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(drop.x, drop.y, drop.r * 1.15, drop.r * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255,255,255,${drop.opacity * 0.85})`;
        ctx.beginPath();
        ctx.arc(drop.x - drop.r * 0.28, drop.y - drop.r * 0.5, Math.max(0.5, drop.r * 0.22), 0, Math.PI * 2);
        ctx.fill();
      }

      if (!once && !reduced) raf = window.requestAnimationFrame(render);
    };

    resize();
    window.addEventListener('resize', resize);
    if (!reduced) {
      raf = window.requestAnimationFrame(render);
    } else {
      render(0, true);
    }

    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden) {
        window.cancelAnimationFrame(raf);
      } else {
        last = 0;
        raf = window.requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tone]);

  return (
    <div className="bg-effect bg-rain" aria-hidden="true">
      <canvas ref={canvasRef} />
      <span className="bg-rain__mist" />
    </div>
  );
}
