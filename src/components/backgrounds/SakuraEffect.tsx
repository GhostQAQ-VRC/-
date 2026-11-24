import { useEffect, useRef } from 'react';

interface Petal {
  x: number;
  y: number;
  size: number;
  speed: number;
  sway: number;
  phase: number;
  rotation: number;
  spin: number;
  opacity: number;
  tint: number;
}

/** Soft sakura petals drifting with the wind. */
export function SakuraEffect() {
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
    let petals: Petal[] = [];

    const create = () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 3 + Math.random() * 7,
      speed: 10 + Math.random() * 30,
      sway: 14 + Math.random() * 34,
      phase: Math.random() * Math.PI * 2,
      rotation: Math.random() * Math.PI * 2,
      spin: -0.7 + Math.random() * 1.4,
      opacity: 0.22 + Math.random() * 0.4,
      tint: Math.random(),
    });

    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(80, Math.max(26, Math.round((width * height) / 26000)));
      petals = Array.from({ length: count }, create);
      if (reduced) render(0, true);
    };

    const drawPetal = (petal: Petal) => {
      const { size } = petal;
      ctx.save();
      ctx.translate(petal.x, petal.y);
      ctx.rotate(petal.rotation);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.bezierCurveTo(size * 0.95, -size * 0.4, size * 0.72, size * 0.6, 0, size);
      ctx.bezierCurveTo(-size * 0.72, size * 0.6, -size * 0.95, -size * 0.4, 0, -size);
      const pink = petal.tint > 0.55;
      ctx.fillStyle = pink
        ? `rgba(255, 178, 208, ${petal.opacity})`
        : `rgba(255, 224, 234, ${petal.opacity * 0.9})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 255, ${petal.opacity * 0.35})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.55);
      ctx.lineTo(0, size * 0.55);
      ctx.stroke();
      ctx.restore();
    };

    const render = (time: number, once = false) => {
      const dt = Math.min(0.05, last ? (time - last) / 1000 : 0.016);
      last = time;
      ctx.clearRect(0, 0, width, height);
      for (const petal of petals) {
        if (!once) {
          petal.y += petal.speed * dt;
          petal.x +=
            Math.sin(time * 0.00045 + petal.phase) * petal.sway * dt +
            Math.cos(time * 0.0002 + petal.phase) * 6 * dt;
          petal.rotation += petal.spin * dt;
          if (petal.y > height + 24) {
            Object.assign(petal, create(), { y: -20, x: Math.random() * width });
          }
          if (petal.x < -30) petal.x = width + 20;
          if (petal.x > width + 30) petal.x = -20;
        }
        drawPetal(petal);
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
    <div className="bg-effect bg-sakura" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
