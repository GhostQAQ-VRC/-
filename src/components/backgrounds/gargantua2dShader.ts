/**
 * Art-directed Gargantua-style backdrop.
 *
 * The composition is built as a photographic plate rather than a literal
 * simulation: a razor-thin photon ring, a luminous volumetric-looking disk,
 * the lensed upper/lower images of that disk, a soft bloom and a lensed
 * starfield. Keeping it in screen space makes the material and glow easier to
 * art-direct than a per-pixel geodesic integration.
 */
export const BLACK_HOLE_FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(15.3, 8.7);
    amplitude *= 0.5;
  }
  return value;
}

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

vec3 starField(vec2 p, float t) {
  vec3 color = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float scale = 76.0 + float(i) * 126.0;
    vec2 grid = p * scale;
    vec2 id = floor(grid);
    vec2 local = fract(grid) - 0.5;
    float h = hash21(id + float(i) * 29.7);
    float mask = step(0.974, h);
    float twinkle = 0.64 + 0.36 * sin(t * (0.7 + h * 2.1) + h * 43.0);
    float d = length(local);
    float core = smoothstep(0.10, 0.0, d);
    float glow = exp(-d * 18.0) * 0.35;
    vec3 tint = mix(vec3(0.64, 0.79, 1.0), vec3(1.0, 0.87, 0.74), hash21(id + 3.0));
    color += tint * (core + glow) * mask * twinkle * (0.40 + 1.5 * pow(hash21(id + 9.0), 2.0));
  }
  return color;
}

float meteor(vec2 uv, float seed, float speed, float t) {
  float cycle = fract(t * speed + seed);
  vec2 head = vec2(mix(-1.45, 1.35, cycle), mix(0.96, -0.84, cycle));
  vec2 dir = normalize(vec2(1.0, -0.68));
  vec2 rel = uv - head;
  float along = dot(rel, dir);
  float perp = abs(dot(rel, vec2(-dir.y, dir.x)));
  float headGlow = smoothstep(0.005, 0.0, perp) * smoothstep(0.022, 0.0, abs(along));
  float tail = smoothstep(-0.34, 0.0, along) * (1.0 - smoothstep(0.0, 0.34, along)) * smoothstep(0.003, 0.0, perp);
  float fade = smoothstep(0.0, 0.10, cycle) * (1.0 - smoothstep(0.90, 1.0, cycle));
  return (headGlow + tail * 0.42) * fade;
}

void main() {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= aspect;
  float t = u_time;

  // A compact, slowly drifting hole. Around 26% of the viewport height.
  vec2 center = vec2(0.12 + 0.07 * sin(t * 0.12), 0.02 + 0.010 * sin(t * 0.09));
  vec2 q = uv - center;
  float r = max(length(q), 0.0001);
  float angle = atan(q.y, q.x);
  float R = 0.24;

  float lens = 0.62 * R * R / (r * r + R * R * 0.24);
  float swirl = 0.55 * lens;
  vec2 warped = center + rotate2d(swirl) * q * (1.0 - 0.82 * lens);

  // Deep navy space, a soft blue nebula and a lensed starfield.
  float nebula = fbm(warped * 0.95 + vec2(t * 0.004, -t * 0.003));
  float nebula2 = fbm(warped * 2.2 - vec2(t * 0.006, t * 0.004));
  vec3 color = mix(vec3(0.004, 0.008, 0.020), vec3(0.012, 0.024, 0.050), smoothstep(-1.0, 1.0, uv.y));
  color += vec3(0.014, 0.032, 0.070) * nebula;
  color += vec3(0.008, 0.024, 0.058) * nebula2 * (0.45 + 0.55 * nebula);
  color += vec3(0.20, 0.32, 0.62) * exp(-r / (R * 2.8)) * 0.07;

  color += starField(warped, t) * 1.55;
  vec2 meteorP = vec2(uv.x / max(aspect, 1.0), uv.y);
  color += vec3(0.86, 0.93, 1.0) * (
    meteor(meteorP, 0.17, 0.032, t) +
    meteor(meteorP, 0.63, 0.023, t) * 0.72
  );

  // The event horizon.
  float shadow = smoothstep(R * 0.995, R * 1.015, r);
  float outside = smoothstep(R * 0.985, R * 1.030, r);
  color *= shadow;

  // Accretion disk frame: a slight tilt, a gentle warp and a flared profile.
  vec2 d = rotate2d(-0.265) * q;
  float warp = R * 0.040 * sin(d.x * 2.2 + t * 0.08);
  float dy = d.y - warp;
  float ax = abs(d.x);
  float thickness = R * (0.060 + 0.225 * pow(clamp(ax / (R * 3.4), 0.0, 1.0), 1.20));
  float side0 = clamp(d.x / (R * 3.0), -1.0, 1.0);
  thickness *= mix(1.22, 0.86, smoothstep(-1.0, 1.0, side0));
  float band = exp(-pow(dy / thickness, 2.0));
  float softBand = exp(-pow(dy / (thickness * 3.0), 2.0));
  float radialFade = 1.0 - smoothstep(R * 2.9, R * 4.1, ax);
  float ellipse = length(vec2(d.x / (R * 4.0), dy / (R * 0.95)));
  float diskMask = 1.0 - smoothstep(0.70, 1.0, ellipse);
  float flow = t * 0.11;
  float filaments = fbm(vec2(d.x * 3.8 - flow * 4.0, dy * 95.0 + 7.0));
  float fine = fbm(vec2(d.x * 12.0 + flow * 2.0, dy * 210.0 - 3.0));
  float texture = 0.30 + 0.86 * filaments + 0.50 * fine;
  float lanes = smoothstep(0.35, 0.72, fbm(vec2(d.x * 13.0 - flow * 5.0, dy * 300.0 + 31.0)));
  texture *= mix(0.40, 1.35, lanes);
  float density = band * radialFade * diskMask * (0.30 + 1.05 * texture) * (0.45 + 0.55 * smoothstep(R * 1.0, R * 3.0, ax));
  float softDensity = softBand * radialFade * diskMask * (0.60 + 0.75 * filaments) * outside;
  float midDensity = exp(-pow(dy / (thickness * 1.45), 2.0)) * radialFade * diskMask * (0.35 + 0.65 * filaments) * outside;

  float heat = clamp((ax - R * 0.7) / (R * 3.4), 0.0, 1.0);
  float side = clamp(d.x / (R * 2.8), -1.0, 1.0);
  vec3 diskColor = mix(vec3(0.86, 0.93, 1.0), vec3(1.0, 0.82, 0.64), smoothstep(0.0, 0.16, heat));
  diskColor = mix(diskColor, vec3(1.0, 0.50, 0.16), smoothstep(0.30, 1.0, heat));
  diskColor = mix(vec3(1.0, 0.74, 0.76), diskColor, 0.50 + 0.50 * smoothstep(-1.0, 0.7, side));

  float beam = mix(0.92, 1.18, smoothstep(-0.9, 0.9, side));
  color += diskColor * density * beam * 2.35;
  color += diskColor * softDensity * beam * 0.85;
  color += diskColor * midDensity * beam * 0.80;
  color += diskColor * exp(-pow(dy / (R * 0.50), 2.0)) * diskMask * 0.04 * outside;

  // The razor-thin hot line of the near disk edge crossing in front.
  float core = exp(-pow(dy / (R * 0.016), 2.0)) * diskMask;
  color += vec3(1.0, 0.94, 0.84) * core * 0.10;

  // Photon ring with a blue-white crown and a warm underside.
  float rr = r;
  float archRadius = length(vec2(q.x, q.y * 0.92));
  float photon = exp(-pow((rr - R * 1.018) / (R * 0.013), 2.0));
  float photonGlow = exp(-abs(rr - R * 1.018) / (R * 0.085));
  float ringTint = smoothstep(-0.10, 0.80, q.y / R + 0.12 * cos(angle));
  vec3 ringColor = mix(vec3(1.0, 0.42, 0.12), vec3(0.58, 0.78, 1.0), ringTint);
  color += ringColor * (photon * 1.75 + photonGlow * 0.32) * outside;

  // Lensed upper image of the disk: a broad, layered arch above the shadow.
  float upper = smoothstep(-0.10, 0.55, q.y / R);
  float archNoise = 0.62 + 0.38 * noise(vec2(angle * 3.0 + t * 0.04, r * 2.8));
  float arch = exp(-pow((archRadius - R * 1.090) / (R * 0.032), 2.0)) * 2.05;
  arch += exp(-pow((archRadius - R * 1.175) / (R * 0.068), 2.0)) * 1.10;
  arch += exp(-pow((archRadius - R * 1.335) / (R * 0.145), 2.0)) * 0.52;
  arch += exp(-pow((archRadius - R * 1.600) / (R * 0.330), 2.0)) * 0.08;
  arch *= upper * archNoise;
  vec3 archColor = mix(vec3(1.0, 0.70, 0.42), vec3(1.0, 0.95, 0.86), 0.66);
  color += archColor * arch * 2.35 * outside;
  color += vec3(1.0, 0.78, 0.56) * exp(-pow((archRadius - R * 1.55) / (R * 0.025), 2.0)) * upper * 0.35 * outside;

  // Blue-white crown sitting directly on the ring.
  float crown = exp(-pow((rr - R * 1.035) / (R * 0.040), 2.0)) * upper;
  color += vec3(0.66, 0.82, 1.0) * crown * 0.55 * outside;
  color += vec3(1.0, 0.78, 0.58) * exp(-pow((archRadius - R * 1.22) / (R * 0.28), 2.0)) * upper * 0.22 * outside;

  // Lower lensed image: a narrow warm crescent.
  float lower = 1.0 - smoothstep(-0.58, 0.06, q.y / R);
  float cup = exp(-pow((rr - R * 1.025) / (R * 0.085), 2.0)) * lower;
  cup *= 0.62 + 0.38 * noise(vec2(angle * 4.0, r * 7.0 + t * 0.15));
  color += vec3(1.0, 0.40, 0.12) * cup * 0.85 * outside;
  color += vec3(1.0, 0.34, 0.08) * exp(-pow((rr - R * 1.30) / (R * 0.26), 2.0)) * lower * 0.14 * outside;

  // Soft photographic bloom and a hint of infalling dust.
  color += vec3(1.0, 0.55, 0.24) * exp(-pow((rr - R * 1.55) / (R * 1.10), 2.0)) * 0.03 * outside;
  color += ringColor * photonGlow * 0.08 * outside;
  float spiralAngle = angle + 1.0 * log(max(r / R, 0.35)) - t * 0.15;
  float dust = fbm(vec2(spiralAngle * 2.6, r * 4.5 - t * 0.20));
  dust = smoothstep(0.70, 0.92, dust) * smoothstep(R * 1.06, R * 1.4, r) * (1.0 - smoothstep(R * 2.6, R * 4.0, r));
  color += vec3(1.0, 0.62, 0.30) * dust * 0.13;

  // Gentle vignette and filmic tone mapping.
  float vignette = 1.0 - 0.42 * smoothstep(0.62, 1.72, length(uv * vec2(0.78, 1.0)));
  color *= vignette;
  color = vec3(1.0) - exp(-color * 1.30);
  color = pow(max(color, 0.0), vec3(0.92));

  gl_FragColor = vec4(color, 1.0);
}
`;
