import { useEffect, useRef, useState } from 'react';
import { Starfield } from '../Starfield';
import { BLACK_HOLE_FRAGMENT_SHADER } from './gargantua2dShader';

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[blackhole] shader', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Cinematic Gargantua-style black hole: lensed disk, photon ring, halo and meteors. */
export function BlackHoleEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      setFailed(true);
      return undefined;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, BLACK_HOLE_FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      setFailed(true);
      return undefined;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[blackhole] link', gl.getProgramInfoLog(program));
      setFailed(true);
      return undefined;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const timeUniform = gl.getUniformLocation(program, 'u_time');
    const resUniform = gl.getUniformLocation(program, 'u_res');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let raf = 0;
    let start = performance.now();
    let last = 0;
    let stopped = false;

    const resize = () => {
      if (stopped) return;
      const dpr = Math.min(1.15, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (reduced) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.uniform1f(timeUniform, 12.0);
        gl.uniform2f(resUniform, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };

    const render = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      const time = reduced ? 12.0 : (now - start) / 1000;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.uniform1f(timeUniform, time);
      gl.uniform2f(resUniform, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) raf = window.requestAnimationFrame(render);
      void dt;
    };

    resize();
    window.addEventListener('resize', resize);
    if (!reduced) raf = window.requestAnimationFrame(render);

    const onVisibility = () => {
      if (reduced || stopped) return;
      if (document.hidden) {
        window.cancelAnimationFrame(raf);
      } else {
        last = 0;
        start = performance.now() - 12 * 1000;
        raf = window.requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, []);

  if (failed) {
    return (
      <>
        <Starfield />
        <div className="bg-blackhole-fallback" aria-hidden="true" />
      </>
    );
  }

  return (
    <div className="bg-effect bg-blackhole" aria-hidden="true">
      <canvas ref={canvasRef} />
      <span className="bg-blackhole__vignette" />
    </div>
  );
}
