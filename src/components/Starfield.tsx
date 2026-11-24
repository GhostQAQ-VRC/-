import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  radius: number;
  baseAlpha: number;
  phase: number;
  speed: number;
  color: string;
  drift: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const STAR_COLORS = ['255,244,226', '244,214,234', '220,226,255', '255,232,200'];

/** Fixed, lightweight star field with slow drift and rare shooting stars. */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let stars: Star[] = [];
    let meteors: Meteor[] = [];
    let animation = 0;
    let lastFrame = 0;
    let nextMeteorAt = performance.now() + 2600;
    let running = true;

    const createStars = () => {
      const count = Math.min(210, Math.round((width * height) / 15000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() < 0.86 ? Math.random() * 1.1 + 0.3 : Math.random() * 1.8 + 1.1,
        baseAlpha: Math.random() * 0.55 + 0.18,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.7 + 0.15,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        drift: Math.random() * 0.024 + 0.004,
      }));
    };

    const resize = () => {
      // 1.5× DPR keeps particles crisp while cutting canvas fill-rate roughly
      // in half versus 2× on high-DPI displays.
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      createStars();
    };

    const spawnMeteor = () => {
      const startX = Math.random() * width * 0.75 + width * 0.1;
      const startY = Math.random() * height * 0.4;
      const angle = Math.PI * 0.22 + Math.random() * 0.12;
      const speed = 520 + Math.random() * 260;
      meteors.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 900 + Math.random() * 500,
      });
    };

    const draw = (time: number) => {
      const delta = Math.min(64, time - lastFrame || 16);
      lastFrame = time;
      ctx.clearRect(0, 0, width, height);

      for (const star of stars) {
        const twinkle = reducedMotion
          ? star.baseAlpha
          : star.baseAlpha + Math.sin((time / 1000) * star.speed + star.phase) * 0.16;
        const alpha = Math.max(0.04, Math.min(0.95, twinkle));
        if (!reducedMotion) {
          star.y -= star.drift * delta;
          if (star.y < -4) {
            star.y = height + 4;
            star.x = Math.random() * width;
          }
        }
        ctx.beginPath();
        ctx.fillStyle = `rgba(${star.color},${alpha.toFixed(3)})`;
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
        if (star.radius > 1.5) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(${star.color},${(alpha * 0.12).toFixed(3)})`;
          ctx.arc(star.x, star.y, star.radius * 4.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (!reducedMotion) {
        if (meteors.length === 0 && time > nextMeteorAt) {
          spawnMeteor();
          nextMeteorAt = time + 7000 + Math.random() * 9000;
        }
        meteors = meteors.filter((meteor) => meteor.life < meteor.maxLife);
        for (const meteor of meteors) {
          meteor.life += delta;
          meteor.x += (meteor.vx * delta) / 1000;
          meteor.y += (meteor.vy * delta) / 1000;
          const fade = Math.sin((meteor.life / meteor.maxLife) * Math.PI);
          const tailX = meteor.x - meteor.vx * 0.16;
          const tailY = meteor.y - meteor.vy * 0.16;
          const gradient = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
          gradient.addColorStop(0, `rgba(255,247,230,${0.75 * fade})`);
          gradient.addColorStop(1, 'rgba(255,247,230,0)');
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(meteor.x, meteor.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();
        }
      }

      if (running) animation = window.requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(animation);
      } else if (!running) {
        running = true;
        lastFrame = performance.now();
        animation = window.requestAnimationFrame(draw);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (reducedMotion) {
      draw(performance.now());
      running = false;
    } else {
      animation = window.requestAnimationFrame(draw);
    }

    return () => {
      running = false;
      window.cancelAnimationFrame(animation);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="starfield" aria-hidden="true" />;
}
