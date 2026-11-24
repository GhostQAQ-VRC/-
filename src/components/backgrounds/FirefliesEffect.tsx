import { useEffect, useRef } from 'react';

interface Fly {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
  drift: number;
  hue: number;
}

/** Slow, breathing firefly lights in the dark. */
export function FirefliesEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let flies: Fly[] = [];

    const create = () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1.2 + Math.random() * 2.6,
      phase: Math.random() * Math.PI * 2,
      speed: 0.2 + Math.random() * 0.8,
      drift: 10 + Math.random() * 34,
      hue: Math.random(),
    });

    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.max(28, Math.round((width * height) / 24000)));
      flies = Array.from({ length: count }, create);
      if (reduced) render(0, true);
    };

    const render = (time: number, once = false) => {
      const dt = Math.min(0.05, last ? (time - last) / 1000 : 0.016);
      last = time;
      ctx.clearRect(0, 0, width, height);

      for (const fly of flies) {
        if (!once) {
          fly.x += Math.sin(time * 0.00035 + fly.phase) * fly.drift * dt;
          fly.y += Math.cos(time * 0.00028 + fly.phase * 1.4) * fly.drift * 0.55 * dt;
          if (fly.x < -20) fly.x = width + 10;
          if (fly.x > width + 20) fly.x = -10;
          if (fly.y < -20) fly.y = height + 10;
          if (fly.y > height + 20) fly.y = -10;
        }
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 0.0012 + fly.phase));
        const alpha = pulse * 0.75;
        const radius = fly.size * (1 + pulse * 0.5);
        const color =
          fly.hue > 0.65
            ? `rgba(196, 255, 188, ${alpha})`
            : fly.hue > 0.3
              ? `rgba(255, 232, 150, ${alpha})`
              : `rgba(214, 255, 220, ${alpha})`;
        const glow = ctx.createRadialGradient(fly.x, fly.y, 0, fly.x, fly.y, radius * 9);
        glow.addColorStop(0, color);
        glow.addColorStop(0.28, `rgba(255, 246, 180, ${alpha * 0.4})`);
        glow.addColorStop(1, 'rgba(255, 246, 180, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(fly.x, fly.y, radius * 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,230,${Math.min(1, alpha * 1.2)})`;
        ctx.beginPath();
        ctx.arc(fly.x, fly.y, Math.max(0.6, radius * 0.42), 0, Math.PI * 2);
        ctx.fill();
      }

      if (!once && !reduced && !document.hidden) raf = window.requestAnimationFrame(render);
    };

    const onVisibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(raf);
      } else if (!reduced) {
        last = 0;
        raf = window.requestAnimationFrame(render);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (!reduced) raf = window.requestAnimationFrame(render);
    else render(0, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="bg-effect bg-fireflies" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
