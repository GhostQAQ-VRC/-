"""Generates original, anime-inspired sample photo artwork for the album demo.

Run: python tools/generate_art.py [scene ...]
Outputs WebP files to public/photos/.
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

from PIL import (
    Image,
    ImageChops,
    ImageDraw,
    ImageEnhance,
    ImageFilter,
    ImageFont,
    ImageOps,
)

W, H = 2400, 1800
OUT_W, OUT_H = 1600, 1200
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "photos"
FONT_JP = "C:/Windows/Fonts/YuGothM.ttc"


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c0, c1, t):
    return tuple(int(lerp(c0[i], c1[i], t)) for i in range(3))


def hx(value: str, alpha: int = 255):
    value = value.lstrip("#")
    return (
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
        alpha,
    )


def vgrad(stops):
    strip = Image.new("RGB", (1, H))
    px = strip.load()
    for y in range(H):
        t = y / (H - 1)
        chosen = stops[-1][1]
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                f = (t - p0) / (p1 - p0) if p1 > p0 else 0
                chosen = mix(c0, c1, f)
                break
        px[0, y] = chosen
    return strip.resize((W, H), Image.Resampling.BILINEAR)


_RADIAL_CACHE: dict[float, Image.Image] = {}


def _radial_base(power: float) -> Image.Image:
    """White in the centre fading to black at the edge (built manually: some
    Pillow builds crash inside Image.radial_gradient)."""
    if power in _RADIAL_CACHE:
        return _RADIAL_CACHE[power]
    size = 192
    base = Image.new("L", (size, size))
    px = base.load()
    half = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            dist = math.hypot(x - half, y - half) / half
            value = 0.0 if dist >= 1 else (1 - dist) ** power
            px[x, y] = int(255 * value)
    _RADIAL_CACHE[power] = base
    return base


def radial_mask(radius: int, power: float = 2.0) -> Image.Image:
    size = max(2, int(radius * 2))
    return _radial_base(power).resize((size, size), Image.Resampling.BILINEAR)


def screen(img: Image.Image, layer: Image.Image) -> Image.Image:
    return ImageChops.screen(img, layer)


def glow(img, center, radius, color, alpha=255, power=2.0):
    layer = Image.new("RGB", (W, H), (0, 0, 0))
    mask = Image.new("L", (W, H), 0)
    m = radial_mask(int(radius), power).point(lambda v: int(v * alpha / 255))
    mask.paste(m, (int(center[0] - radius), int(center[1] - radius)))
    solid = Image.new("RGB", (W, H), color[:3])
    return screen(img, Image.composite(solid, layer, mask))


def overlay(img, layer):
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def new_layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def soft_blobs(base, blobs, blur=60):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    for cx, cy, rx, ry, color, alpha in blobs:
        d.ellipse(
            [cx - rx, cy - ry, cx + rx, cy + ry],
            fill=color[:3] + (alpha,),
        )
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return overlay(base, layer)


def stars(base, rng, count=300, y_max=0.6, color=(255, 248, 232), bright=255, sparkle=True):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    sparkle_layer = new_layer()
    sd = ImageDraw.Draw(sparkle_layer)
    for _ in range(count):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H * y_max)
        r = rng.choice([1, 1, 1, 2, 2, 3, 4])
        a = rng.randint(45, bright)
        d.ellipse([x - r, y - r, x + r, y + r], fill=color + (a,))
    for _ in range(max(2, count // 55)):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H * y_max * 0.9)
        r = rng.uniform(8, 20)
        a = rng.randint(50, 120)
        sd.line([(x - r, y), (x + r, y)], fill=color + (a,), width=2)
        sd.line([(x, y - r), (x, y + r)], fill=color + (a,), width=2)
        sd.ellipse([x - 3, y - 3, x + 3, y + 3], fill=color + (min(255, a + 70),))
    if sparkle:
        layer = Image.alpha_composite(layer, sparkle_layer.filter(ImageFilter.GaussianBlur(1.5)))
    return overlay(base, layer)


def mountain_profile(rng, samples=257):
    """Midpoint-displacement silhouette values in roughly 0..1."""
    values = [0.0] * samples
    values[0] = rng.uniform(0.25, 0.55)
    values[-1] = rng.uniform(0.2, 0.5)
    step = samples - 1
    disp = 0.55
    while step > 1:
        half = step // 2
        for i in range(half, samples, step):
            values[i] = (values[i - half] + values[i + half]) / 2 + rng.uniform(-disp, disp)
        step = half
        disp *= 0.52
    lo, hi = min(values), max(values)
    return [max(0.0, (v - lo) / (hi - lo) if hi > lo else 0.5) for v in values]


def ridge_points(rng, base_y, height, roughness=0.5, skew=0.0):
    """A smooth mountain ridge silhouette polygon across the frame."""
    profile = mountain_profile(rng)
    n = len(profile)
    pts = []
    for i, v in enumerate(profile):
        t = i / (n - 1)
        y = base_y - height * (0.18 + v * 0.82) + skew * height * (t - 0.5)
        pts.append((t * W, y))
    pts += [(W, H + 20), (0, H + 20)]
    return pts


def ridge(base, rng, base_y, height, color, roughness=0.5, skew=0.0, blur=0):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    pts = ridge_points(rng, base_y, height, roughness, skew)
    d.polygon(pts, fill=color[:3] + (255,))
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return overlay(base, layer)


def haze(base, top, bottom, color, alpha_top=0, alpha_bottom=90):
    """Vertical atmospheric haze band."""
    mask = Image.new("L", (1, H))
    px = mask.load()
    for y in range(H):
        t = y / (H - 1)
        a = 0
        if top <= t <= bottom:
            f = (t - top) / max(1e-6, bottom - top)
            a = int(lerp(alpha_top, alpha_bottom, f))
        px[0, y] = a
    mask = mask.resize((W, H))
    solid = Image.new("RGB", (W, H), color[:3])
    return overlay(base, Image.merge("RGBA", (*solid.split(), mask)))


def petals(base, rng, count=70, area=(0, 0, W, H), blur=2, size=(5, 14), color="#f9c6d9"):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    for _ in range(count):
        x = rng.uniform(area[0], area[2])
        y = rng.uniform(area[1], area[3])
        w = rng.uniform(size[0], size[1])
        h = w * rng.uniform(0.45, 0.8)
        angle = rng.uniform(0, math.pi)
        pts = []
        for i in range(8):
            a = i / 8 * 2 * math.pi
            px = x + math.cos(a) * w * 0.5 * math.cos(angle) - math.sin(a) * h * 0.5 * math.sin(angle)
            py = y + math.cos(a) * w * 0.5 * math.sin(angle) + math.sin(a) * h * 0.5 * math.cos(angle)
            pts.append((px, py))
        alpha = rng.randint(90, 230)
        d.polygon(pts, fill=hx(color, alpha))
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return overlay(base, layer)


def sparkle_glow(base, center, color="#fff6df", size=30, alpha=140):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    x, y = center
    d.line([(x - size, y), (x + size, y)], fill=hx(color, alpha), width=3)
    d.line([(x, y - size), (x, y + size)], fill=hx(color, alpha), width=3)
    d.line([(x - size * 0.45, y - size * 0.45), (x + size * 0.45, y + size * 0.45)], fill=hx(color, alpha // 2), width=2)
    d.line([(x - size * 0.45, y + size * 0.45), (x + size * 0.45, y - size * 0.45)], fill=hx(color, alpha // 2), width=2)
    layer = layer.filter(ImageFilter.GaussianBlur(3))
    return screen(overlay(base, layer), layer.convert("RGB").filter(ImageFilter.GaussianBlur(18)))


def mountain_fog(base, top, bottom, color="#c9a3b8", alpha=80):
    return haze(base, top, bottom, hx(color)[:3], 0, alpha)


def finish(img, bloom=0.22, grain=0.05, vignette=0.55, saturation=1.05, contrast=1.03):
    bright = img.point(lambda v: 0 if v < 168 else min(255, (v - 168) * 3))
    glow_layer = bright.filter(ImageFilter.GaussianBlur(52)).point(lambda v: int(v * bloom))
    img = screen(img, glow_layer)
    mask = _radial_base(1.0).resize((W, H), Image.Resampling.BILINEAR).point(
        lambda v: int((v / 255) ** 1.7 * vignette * 255)
    )
    dark = Image.new("RGB", (W, H), (6, 5, 16))
    img = Image.composite(dark, img, mask)
    noise = Image.effect_noise((W, H), 16).convert("RGB")
    img = Image.blend(img, noise, grain)
    img = ImageEnhance.Color(img).enhance(saturation)
    img = ImageEnhance.Contrast(img).enhance(contrast)
    return img


TORII_DARK = "#150f22"


def draw_torii(layer, cx, base_y, height, color=TORII_DARK, alpha=255, rim="#f0a9c0"):
    d = ImageDraw.Draw(layer)
    hw = height * 0.42
    lean = height * 0.035
    sw = height * 0.075
    col = hx(color, alpha)
    # pillars, slightly tapered inward
    for side in (-1, 1):
        top_x = cx + side * (hw - lean)
        bot_x = cx + side * (hw + lean * 0.3)
        d.polygon(
            [
                (top_x - sw / 2, base_y - height * 0.62),
                (top_x + sw / 2, base_y - height * 0.62),
                (bot_x + sw / 2.25, base_y),
                (bot_x - sw / 2.25, base_y),
            ],
            fill=col,
        )
    # kasagi (top beam, gently upswept)
    beam_y = base_y - height * 0.66
    d.polygon(
        [
            (cx - hw - height * 0.17, beam_y - height * 0.015),
            (cx + hw + height * 0.17, beam_y - height * 0.015),
            (cx + hw + height * 0.19, beam_y + height * 0.035),
            (cx - hw - height * 0.19, beam_y + height * 0.035),
        ],
        fill=col,
    )
    d.polygon(
        [
            (cx - hw - height * 0.2, beam_y - height * 0.012),
            (cx - hw - height * 0.13, beam_y - height * 0.045),
            (cx - hw - height * 0.03, beam_y - height * 0.03),
            (cx + hw + height * 0.03, beam_y - height * 0.03),
            (cx + hw + height * 0.13, beam_y - height * 0.045),
            (cx + hw + height * 0.2, beam_y - height * 0.012),
        ],
        fill=col,
    )
    # nuki (second beam)
    nuki_y = base_y - height * 0.48
    d.rectangle([cx - hw - lean, nuki_y, cx + hw + lean, nuki_y + height * 0.035], fill=col)
    # gakuzuka
    d.rectangle(
        [cx - height * 0.022, beam_y, cx + height * 0.022, nuki_y],
        fill=col,
    )
    # rim light
    rim_layer = new_layer()
    rd = ImageDraw.Draw(rim_layer)
    for side in (-1, 1):
        x = cx + side * (hw - lean)
        rd.line([(x - sw / 2, base_y - height * 0.62), (x - sw / 2.25, base_y)], fill=hx(rim, 90), width=3)
    rd.line(
        [(cx - hw - height * 0.18, beam_y + height * 0.026), (cx + hw + height * 0.18, beam_y + height * 0.026)],
        fill=hx(rim, 80),
        width=3,
    )
    return overlay(layer, rim_layer)


def draw_sakura_tree(layer, rng, origin, scale, color="#1a1124", blossom=True, blossom_layer=None, base_angle=-math.pi / 2):
    """Recursive sakura silhouette. Blossoms land on blossom_layer."""
    d = ImageDraw.Draw(layer)
    bd = ImageDraw.Draw(blossom_layer) if blossom_layer is not None else None
    blossom_colors = ["#f2a6c4", "#ffc2da", "#ffe3ee", "#e991b5", "#ffd0e2"]

    def cluster(x, y, radius, density=26, alpha=(50, 170)):
        if bd is None:
            return
        bd.ellipse(
            [x - radius * 0.9, y - radius * 0.65, x + radius * 0.9, y + radius * 0.65],
            fill=hx("#f7b9cf", 26),
        )
        for _ in range(density):
            a = rng.uniform(0, math.tau)
            dist = abs(rng.gauss(0, 0.45)) * radius
            bx = x + math.cos(a) * dist
            by = y + math.sin(a) * dist * 0.65
            r = rng.uniform(0.08, 0.24) * radius
            bd.ellipse(
                [bx - r, by - r * 0.75, bx + r, by + r * 0.75],
                fill=hx(rng.choice(blossom_colors), rng.randint(*alpha)),
            )

    def branch(x, y, angle, length, width, depth):
        if depth <= 0 or length < 8:
            return
        bend = rng.uniform(-0.22, 0.22) * length
        mx = x + math.cos(angle) * length * 0.5 - math.sin(angle) * bend
        my = y + math.sin(angle) * length * 0.5 + math.cos(angle) * bend
        x2 = x + math.cos(angle) * length
        y2 = y + math.sin(angle) * length
        pts = []
        for i in range(7):
            t = i / 6
            px = (1 - t) ** 2 * x + 2 * (1 - t) * t * mx + t ** 2 * x2
            py = (1 - t) ** 2 * y + 2 * (1 - t) * t * my + t ** 2 * y2
            pts.append((px, py))
        d.line(pts, fill=hx(color), width=max(2, int(width)), joint="curve")
        if depth <= 4:
            cluster(x2, y2, (64 + (4 - depth) * 18) * scale, density=22 + (4 - depth) * 10)
        if depth <= 2:
            n = rng.randint(4, 6)
            for _ in range(n):
                cluster(x2 + rng.uniform(-length, length) * 0.35, y2 + rng.uniform(-length, length) * 0.3, rng.uniform(30, 70) * scale, density=14)
        for k in range(rng.choice([2, 2, 2, 3])):
            branch(
                x2,
                y2,
                angle + rng.uniform(-0.7, 0.7) + (0.14 if k == 2 else -0.1),
                length * rng.uniform(0.62, 0.82),
                width * 0.6,
                depth - 1,
            )

    x, y = origin
    trunk_h = 330 * scale
    d.polygon(
        [(x - 34 * scale, y + trunk_h), (x + 34 * scale, y + trunk_h), (x + 18 * scale, y), (x - 22 * scale, y)],
        fill=hx(color),
    )
    branch(x, y, base_angle + rng.uniform(-0.1, 0.1), 250 * scale, 30 * scale, 5)
    if blossom_layer is not None and blossom:
        # cloth-like canopy haze behind the individual blossoms
        haze_layer = new_layer()
        hd = ImageDraw.Draw(haze_layer)
        hd.ellipse([x - 380 * scale, y - 560 * scale, x + 260 * scale, y - 40 * scale], fill=hx("#f2a9c6", 38))
        hd.ellipse([x - 620 * scale, y - 460 * scale, x + 40 * scale, y + 20 * scale], fill=hx("#f7bcd3", 28))
        blossom_layer.alpha_composite(haze_layer.filter(ImageFilter.GaussianBlur(70)))


def lantern(layer, x, y, s, body="#ffcf8f", glow_alpha=190):
    d = ImageDraw.Draw(layer)
    d.rectangle([x - s * 0.45, y - s * 0.8, x + s * 0.45, y + s * 0.6], fill=hx("#231827", 235))
    d.rectangle([x - s * 0.3, y - s * 0.55, x + s * 0.3, y + s * 0.3], fill=hx(body, 240))
    d.line([(x, y - s * 0.9), (x, y - s * 0.7)], fill=hx("#1a1320"), width=max(1, int(s * 0.08)))
    d.line([(x - s * 0.4, y - s * 0.8), (x + s * 0.4, y - s * 0.8)], fill=hx("#1a1320"), width=max(1, int(s * 0.1)))


def scene_sakura_shrine(rng):
    img = vgrad(
        [
            (0.0, hx("#100c28")[:3]),
            (0.32, hx("#2b1b45")[:3]),
            (0.54, hx("#5c3359")[:3]),
            (0.7, hx("#a8576f")[:3]),
            (0.8, hx("#e59a8c")[:3]),
            (0.9, hx("#f7c6a8")[:3]),
            (1.0, hx("#2a1a2c")[:3]),
        ]
    )
    img = stars(img, rng, 360, 0.5)
    img = glow(img, (W * 0.735, H * 0.2), W * 0.26, hx("#ffe9cf")[:3], 120, 2.4)
    moon_layer = new_layer()
    md = ImageDraw.Draw(moon_layer)
    md.ellipse([W * 0.735 - 88, H * 0.2 - 88, W * 0.735 + 88, H * 0.2 + 88], fill=hx("#fff6e2"))
    md.ellipse([W * 0.7, H * 0.175, W * 0.728, H * 0.2], fill=hx("#f3e5d0"))
    md.ellipse([W * 0.748, H * 0.22, W * 0.769, H * 0.24], fill=hx("#f6ead8"))
    img = overlay(img, moon_layer)

    # distant mountain layers with haze
    img = ridge(img, rng, H * 0.64, H * 0.2, hx("#5a3d5f")[:3], 0.35, 0.1, 6)
    img = mountain_fog(img, 0.5, 0.68, "#f0b0a4", 110)
    img = ridge(img, rng, H * 0.7, H * 0.16, hx("#33223f")[:3], 0.55, -0.05, 2)
    img = mountain_fog(img, 0.6, 0.73, "#c98a92", 70)

    # misty lake
    lake = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lake)
    ld.rectangle([0, H * 0.7, W, H * 0.82], fill=hx("#3a2745", 180))
    img = overlay(img, lake)
    for i in range(26):
        y = rng.uniform(H * 0.705, H * 0.81)
        x = rng.uniform(0, W)
        length = rng.uniform(W * 0.03, W * 0.16)
        a = rng.randint(12, 50)
        glow_layer = new_layer()
        gd = ImageDraw.Draw(glow_layer)
        gd.line([(x, y), (x + length, y)], fill=hx("#ffd3b8", a), width=2)
        img = overlay(img, glow_layer.filter(ImageFilter.GaussianBlur(1.4)))
    # moon reflection
    for i in range(30):
        y = rng.uniform(H * 0.7, H * 0.815)
        x = W * 0.735 + rng.uniform(-90, 90)
        l = rng.uniform(10, 70)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.line([(x - l, y), (x + l, y)], fill=hx("#ffe8c6", rng.randint(20, 90)), width=rng.choice([2, 3]))
        img = overlay(img, layer.filter(ImageFilter.GaussianBlur(1.2)))

    # promontory with shrine
    img = ridge(img, rng, H * 0.93, H * 0.1, hx("#1c1327")[:3], 0.35, 0.0, 1)
    hill = new_layer()
    hd = ImageDraw.Draw(hill)
    hd.polygon(
        [(W * -0.05, H), (W * -0.05, H * 0.78), (W * 0.12, H * 0.74), (W * 0.3, H * 0.77), (W * 0.46, H * 0.73), (W * 0.6, H * 0.78), (W * 0.7, H * 0.86), (W * 0.7, H)],
        fill=hx("#17101f"),
    )
    img = overlay(img, hill.filter(ImageFilter.GaussianBlur(1.2)))

    # small shrine pavilion beside the torii
    shrine_layer = new_layer()
    shd = ImageDraw.Draw(shrine_layer)
    sx, sy, sw = W * 0.515, H * 0.752, W * 0.115
    shd.rectangle([sx - sw * 0.42, sy - sw * 0.24, sx + sw * 0.42, sy], fill=hx("#150e1e"))
    shd.polygon(
        [
            (sx - sw * 0.72, sy - sw * 0.24),
            (sx - sw * 0.52, sy - sw * 0.44),
            (sx, sy - sw * 0.38),
            (sx + sw * 0.52, sy - sw * 0.44),
            (sx + sw * 0.72, sy - sw * 0.24),
            (sx + sw * 0.5, sy - sw * 0.28),
            (sx - sw * 0.5, sy - sw * 0.28),
        ],
        fill=hx("#120c1a"),
    )
    shd.rectangle([sx - sw * 0.09, sy - sw * 0.19, sx + sw * 0.09, sy - sw * 0.02], fill=hx("#ffcf98", 235))
    img = overlay(img, shrine_layer)
    img = glow(img, (sx, sy - sw * 0.1), sw * 0.38, hx("#ffc88f")[:3], 90, 2.3)

    # torii on the hill
    torii = new_layer()
    draw_torii(torii, W * 0.37, H * 0.755, H * 0.235, "#17101f", 255, "#f3a9bb")
    img = overlay(img, torii)
    img = glow(img, (W * 0.37, H * 0.72), W * 0.1, hx("#ffcf9f")[:3], 55, 2.5)

    # floating lanterns on the lake
    for _ in range(5):
        lx = rng.uniform(W * 0.62, W * 0.95)
        ly = rng.uniform(H * 0.72, H * 0.79)
        img = glow(img, (lx, ly), rng.uniform(16, 30), hx("#ffcb8e")[:3], 110, 2.2)
        refl = new_layer()
        rd = ImageDraw.Draw(refl)
        rd.ellipse([lx - 26, ly + 8, lx + 26, ly + 20], fill=hx("#ffcb8e", 60))
        img = overlay(img, refl.filter(ImageFilter.GaussianBlur(6)))

    # stone lanterns leading down
    for i, (fx, fy, fs) in enumerate([(0.2, 0.84, 26), (0.255, 0.87, 32), (0.315, 0.905, 40), (0.12, 0.9, 34)]):
        img = glow(img, (W * fx, H * fy - fs * 0.5), W * 0.045, hx("#ffc987")[:3], 90, 2.2)
        layer = new_layer()
        lantern(layer, W * fx, H * fy, fs * 1.35)
        img = overlay(img, layer)

    # soft path leading toward the torii
    path_layer = new_layer()
    pd = ImageDraw.Draw(path_layer)
    pd.polygon(
        [(W * 0.44, H * 0.76), (W * 0.47, H * 0.76), (W * 0.66, H), (W * 0.28, H)],
        fill=hx("#e8b7ad", 13),
    )
    img = overlay(img, path_layer.filter(ImageFilter.GaussianBlur(30)))
    for i in range(7):
        t = i / 6
        x = W * lerp(0.455, 0.47, t) + math.sin(t * 3) * 10
        y = H * lerp(0.79, 0.99, t)
        s = lerp(7, 34, t)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.ellipse([x - s, y - s * 0.32, x + s, y + s * 0.32], fill=hx("#2a1e31", 220))
        img = overlay(img, layer)

    # sakura tree on right, framing
    blossom_layer = new_layer()
    tree_layer = new_layer()
    draw_sakura_tree(
        tree_layer,
        rng,
        (W * 0.965, H * 0.55),
        1.35,
        "#170f20",
        True,
        blossom_layer,
        base_angle=-2.42,
    )
    blossom_layer = blossom_layer.filter(ImageFilter.GaussianBlur(1.8))
    img = glow(img, (W * 0.83, H * 0.3), W * 0.22, hx("#ffb6cf")[:3], 80, 2.6)
    img = overlay(img, tree_layer)
    img = overlay(img, blossom_layer)
    img = petals(img, rng, 110, (0, H * 0.18, W, H * 0.95), 2.5, (4, 13))
    # airborne foreground petals, soft
    fg = new_layer()
    fd = ImageDraw.Draw(fg)
    for _ in range(26):
        x = rng.uniform(W * 0.55, W)
        y = rng.uniform(H * 0.05, H * 0.7)
        r = rng.uniform(8, 22)
        fd.ellipse([x - r, y - r * 0.5, x + r, y + r * 0.5], fill=hx("#ffc9dd", rng.randint(40, 110)))
    img = overlay(img, fg.filter(ImageFilter.GaussianBlur(7)))
    img = sparkle_glow(img, (W * 0.68, H * 0.34), "#ffd9e6", 24, 90)
    return finish(img, bloom=0.2, grain=0.05, vignette=0.6)


def scene_moon_garden(rng):
    img = vgrad(
        [
            (0.0, hx("#070b22")[:3]),
            (0.3, hx("#17214a")[:3]),
            (0.55, hx("#40365f")[:3]),
            (0.72, hx("#8a6a83")[:3]),
            (0.85, hx("#c8989d")[:3]),
            (1.0, hx("#2a2236")[:3]),
        ]
    )
    img = stars(img, rng, 520, 0.55)
    img = glow(img, (W * 0.3, H * 0.26), W * 0.3, hx("#dfe8ff")[:3], 100, 2.2)
    ml = new_layer()
    md = ImageDraw.Draw(ml)
    md.ellipse([W * 0.3 - 150, H * 0.26 - 150, W * 0.3 + 150, H * 0.26 + 150], fill=hx("#fff6e5"))
    md.ellipse([W * 0.255, H * 0.225, W * 0.295, H * 0.255], fill=hx("#f3e4d1"))
    md.ellipse([W * 0.318, H * 0.278, W * 0.345, H * 0.298], fill=hx("#f7ebda"))
    img = overlay(img, ml)

    img = ridge(img, rng, H * 0.66, H * 0.14, hx("#2c2647")[:3], 0.4, 0.0, 4)
    img = mountain_fog(img, 0.55, 0.7, "#b8a5c9", 80)
    img = ridge(img, rng, H * 0.76, H * 0.12, hx("#1a1730")[:3], 0.6, 0.0, 1)

    # lavender field foreground
    field = new_layer()
    fd = ImageDraw.Draw(field)
    fd.polygon([(0, H * 0.72), (W, H * 0.7), (W, H), (0, H)], fill=hx("#181426"))
    img = overlay(img, field)
    # soft banks of lavender to give the field volume
    mounds = new_layer()
    mdw = ImageDraw.Draw(mounds)
    for _ in range(200):
        x = rng.uniform(-0.05, 1.05) * W
        y = rng.uniform(0.715, 0.99) * H
        depth = (y - H * 0.715) / (H * 0.285)
        rx = rng.uniform(18, 85) * (0.5 + depth)
        ry = rx * rng.uniform(0.2, 0.4)
        mdw.ellipse(
            [x - rx, y - ry, x + rx, y + ry],
            fill=hx(rng.choice(["#6b5990", "#7f69a8", "#544578", "#9580ba"]), rng.randint(25, 80)),
        )
    img = overlay(img, mounds.filter(ImageFilter.GaussianBlur(9)))
    stems = new_layer()
    st = ImageDraw.Draw(stems)
    for i in range(800):
        x = rng.uniform(-40, W + 40)
        yy = rng.uniform(H * 0.72, H)
        depth = (yy - H * 0.72) / (H * 0.28)
        h = 6 + depth * 55
        colors = ["#6f5d9c", "#8b74b8", "#a68bc9", "#5a4a7d", "#c2a5d9"]
        c = hx(rng.choice(colors), rng.randint(60, 180))
        st.line([(x, yy), (x + rng.uniform(-6, 6), yy - h)], fill=c, width=1 + int(depth * 3))
        st.ellipse([x - 2 - depth * 2, yy - h - 2, x + 2 + depth * 2, yy - h + 3], fill=hx("#d9c0ef", rng.randint(40, 140)))
    img = overlay(img, stems)
    img = haze(img, 0.69, 0.8, hx("#c7b3d9")[:3], 0, 60)

    # winding path
    path = new_layer()
    pd = ImageDraw.Draw(path)
    pd.polygon([(W * 0.47, H * 0.73), (W * 0.54, H * 0.73), (W * 0.72, H), (W * 0.3, H)], fill=hx("#b9aec6", 26))
    img = overlay(img, path.filter(ImageFilter.GaussianBlur(16)))

    # lone tree left, blooming in the moonlight
    tree_layer = new_layer()
    bl = new_layer()
    draw_sakura_tree(
        tree_layer, rng, (W * 0.04, H * 0.66), 1.45, "#100d1c", True, bl, base_angle=-0.92
    )
    img = overlay(img, tree_layer)
    img = overlay(img, bl.filter(ImageFilter.GaussianBlur(2.0)))
    # fireflies
    for _ in range(70):
        x = rng.uniform(0, W)
        y = rng.uniform(H * 0.55, H * 0.98)
        r = rng.uniform(3, 9)
        img = glow(img, (x, y), r * 5, hx("#ffe7a8")[:3], rng.randint(40, 110), 2.4)
    img = petals(img, rng, 40, (0, 0, W, H * 0.8), 3, (4, 10))
    return finish(img, bloom=0.18, grain=0.055, vignette=0.55)


def scene_neon(rng):
    img = vgrad(
        [
            (0.0, hx("#05040e")[:3]),
            (0.3, hx("#0a081b")[:3]),
            (0.55, hx("#171029")[:3]),
            (0.7, hx("#241634")[:3]),
            (0.78, hx("#120c1e")[:3]),
            (1.0, hx("#080611")[:3]),
        ]
    )
    vp = (W * 0.505, H * 0.455)

    # distant skyline behind the alley
    skyline = new_layer()
    sd = ImageDraw.Draw(skyline)
    for _ in range(22):
        bw = rng.uniform(0.025, 0.07) * W
        bh = rng.uniform(0.04, 0.14) * H
        bx = rng.uniform(W * 0.2, W * 0.8)
        by = vp[1] - bh
        sd.rectangle([bx, by, bx + bw, by + bh], fill=hx("#0c0919", 240))
        for _ in range(rng.randint(2, 6)):
            wx = bx + rng.uniform(3, max(4, bw - 12))
            wy = by + rng.uniform(3, max(4, bh - 16))
            sd.rectangle(
                [wx, wy, wx + rng.uniform(3, 8), wy + rng.uniform(4, 10)],
                fill=hx(rng.choice(["#f4b880", "#8ed9e4", "#d79fdd"]), rng.randint(30, 90)),
            )
    img = overlay(img, skyline.filter(ImageFilter.GaussianBlur(4)))
    img = glow(img, vp, W * 0.26, hx("#6f4a8e")[:3], 90, 2.0)
    img = glow(img, (vp[0], vp[1] + H * 0.1), W * 0.18, hx("#c46493")[:3], 60, 2.3)

    # misty depth around the vanishing point
    img = soft_blobs(
        img,
        [
            (vp[0] - W * 0.08, vp[1] + H * 0.03, W * 0.16, H * 0.05, hx("#8b5d95"), 40),
            (vp[0] + W * 0.12, vp[1] + H * 0.05, W * 0.14, H * 0.04, hx("#d27c9f"), 35),
        ],
        60,
    )

    # wet street
    street_img = vgrad(
        [
            (0.0, hx("#191226")[:3]),
            (0.35, hx("#120e1e")[:3]),
            (1.0, hx("#06050c")[:3]),
        ]
    )
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.polygon([vp, (W, H), (0, H)], fill=255)
    img = Image.composite(street_img, img, mask)

    # facades
    left_face = [(0, -20), (W * 0.335, H * 0.315), (W * 0.335, H * 0.94), (0, H + 20)]
    right_face = [(W, -20), (W * 0.665, H * 0.315), (W * 0.665, H * 0.94), (W, H + 20)]
    for pts, edge_color in [
        (left_face, "#5b3357"),
        (right_face, "#4f2b50"),
    ]:
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.polygon(pts, fill=hx("#0a0814", 252))
        img = overlay(img, layer)
    # lit facade edges
    edges = new_layer()
    ed = ImageDraw.Draw(edges)
    ed.line([(W * 0.335, H * 0.315), (W * 0.335, H * 0.94)], fill=hx("#6f3f63", 120), width=3)
    ed.line([(W * 0.665, H * 0.315), (W * 0.665, H * 0.94)], fill=hx("#6a3a60", 110), width=3)
    img = overlay(img, edges.filter(ImageFilter.GaussianBlur(2)))
    # building tops
    tops = new_layer()
    td = ImageDraw.Draw(tops)
    td.polygon([(0, -10), (W * 0.335, H * 0.315), (W * 0.335, H * 0.335), (0, H * 0.035)], fill=hx("#161024"))
    td.polygon([(W, -10), (W * 0.665, H * 0.315), (W * 0.665, H * 0.335), (W, H * 0.035)], fill=hx("#141022"))
    img = overlay(img, tops)

    # window grid on both facades, following perspective
    window_sharp = new_layer()
    window_glow = new_layer()
    ws = ImageDraw.Draw(window_sharp)
    wg = ImageDraw.Draw(window_glow)
    for side in (-1, 1):
        for col in range(11):
            t = col / 10  # 0 near camera, 1 near vanishing point
            fx = lerp(0.008, 0.315, t)
            x_far = W * (0.5 + side * (0.5 - fx))
            col_w = lerp(46, 9, t)
            y_top = lerp(0.1, 0.4, t) * H
            y_bot = lerp(0.94, 0.52, t) * H
            rows = 12
            for row in range(rows):
                yy = lerp(y_top, y_bot, (row + 0.25) / rows)
                if rng.random() < 0.58:
                    continue
                ww = col_w * rng.uniform(0.6, 1.05)
                hh = (y_bot - y_top) / rows * rng.uniform(0.35, 0.62)
                color = rng.choice(["#ffc07c", "#ffe0a3", "#74d9e0", "#d59ce6", "#ff9fc1"])
                alpha = int(rng.randint(40, 165) * (0.6 if t > 0.55 else 1.0))
                rect = [x_far - ww / 2, yy, x_far + ww / 2, yy + hh]
                ws.rectangle(rect, fill=hx(color, alpha))
                wg.rectangle(rect, fill=hx(color, 80))
    img = screen(img, window_glow.filter(ImageFilter.GaussianBlur(9)).convert("RGB"))
    img = overlay(img, window_sharp)

    signs = []

    def sign(cx, cy, w, h, color, text, vertical=False, sub=None):
        nonlocal img
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        x0, y0 = cx - w / 2, cy - h / 2
        radius = min(w, h) * 0.08
        d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=radius, fill=hx("#080611", 244))
        d.rounded_rectangle(
            [x0, y0, x0 + w, y0 + h],
            radius=radius,
            outline=hx(color, 235),
            width=max(2, int(min(w, h) * 0.03)),
        )
        font_size = int(min(w * 0.55, h / max(1, len(text)) * 0.72)) if vertical else int(h * 0.46)
        try:
            font = ImageFont.truetype(FONT_JP, max(14, font_size))
            sub_font = ImageFont.truetype(FONT_JP, max(11, int(font_size * 0.3)))
        except OSError:
            font = ImageFont.load_default()
            sub_font = font
        if vertical:
            step = h * 0.86 / len(text)
            for i, ch in enumerate(text):
                d.text((cx, y0 + h * 0.07 + step * (i + 0.5)), ch, font=font, fill=hx(color, 250), anchor="mm")
        else:
            d.text((cx, cy - h * 0.06), text, font=font, fill=hx(color, 250), anchor="mm")
        if sub:
            d.text((cx, y0 + h * 0.87), sub, font=sub_font, fill=hx(color, 170), anchor="mm")
        # halo
        halo = new_layer()
        hd = ImageDraw.Draw(halo)
        hd.rounded_rectangle([x0 - w * 0.1, y0 - h * 0.04, x0 + w * 1.1, y0 + h * 1.04], radius=radius * 2, fill=hx(color, 120))
        img = screen(img, halo.filter(ImageFilter.GaussianBlur(46)).convert("RGB"))
        img = overlay(img, layer)
        signs.append((cx, cy + h / 2, w, color))

    sign(W * 0.762, H * 0.315, 190, 620, "#ff8fc5", "月灯り", vertical=True, sub="TSUKIAKARI")
    sign(W * 0.185, H * 0.36, 300, 82, "#78e6df", "酒処 ほしあかり")
    sign(W * 0.145, H * 0.52, 210, 70, "#dfa3ff", "カラオケ")
    sign(W * 0.268, H * 0.27, 96, 230, "#ff9bb8", "夜", vertical=True)
    sign(W * 0.87, H * 0.53, 300, 78, "#82f2dd", "OPEN 24H", sub="星屑通り")
    sign(W * 0.668, H * 0.62, 210, 64, "#ffd494", "喫茶 星灯")
    sign(W * 0.63, H * 0.25, 130, 180, "#93b4ff", "星", vertical=True)
    # tiny distant signs
    for i in range(7):
        x = lerp(W * 0.4, W * 0.6, rng.random())
        y = lerp(H * 0.37, H * 0.49, rng.random())
        w, h = rng.uniform(20, 46), rng.uniform(10, 22)
        img = glow(img, (x, y), rng.uniform(28, 55), hx(rng.choice(["#ff9cc8", "#8ff0e6", "#ffd79a"]))[:3], 80, 2.0)

    # shop doorway with warm light on the left
    door = new_layer()
    dd = ImageDraw.Draw(door)
    dx, dy, dw, dh = W * 0.075, H * 0.66, W * 0.08, H * 0.2
    dd.rectangle([dx - dw * 0.6, dy - dh * 0.5, dx + dw * 0.6, dy + dh * 0.5], fill=hx("#ffcd92"))
    dd.rectangle([dx - dw * 0.72, dy - dh * 0.62, dx + dw * 0.72, dy - dh * 0.46], fill=hx("#241428"))
    img = overlay(img, door)
    img = glow(img, (dx, dy), W * 0.09, hx("#ffbe7e")[:3], 110, 2.2)
    # noren curtain strips
    noren = new_layer()
    nd = ImageDraw.Draw(noren)
    for i in range(3):
        nx = dx - dw * 0.48 + i * dw * 0.34
        nd.rectangle([nx, dy - dh * 0.46, nx + dw * 0.26, dy - dh * 0.1], fill=hx("#2a1a35", 220))
    img = overlay(img, noren)

    # vending machine
    vm = new_layer()
    vd = ImageDraw.Draw(vm)
    vx, vy, vw, vh = W * 0.205, H * 0.75, W * 0.038, H * 0.1
    vd.rounded_rectangle([vx - vw / 2, vy - vh / 2, vx + vw / 2, vy + vh / 2], radius=6, fill=hx("#0c0d1c"))
    vd.rectangle([vx - vw * 0.4, vy - vh * 0.38, vx + vw * 0.4, vy + vh * 0.08], fill=hx("#dff8ff", 210))
    for i in range(3):
        for j in range(2):
            vd.rectangle(
                [vx - vw * 0.33 + j * vw * 0.34, vy - vh * 0.3 + i * vh * 0.11, vx - vw * 0.23 + j * vw * 0.34, vy - vh * 0.22 + i * vh * 0.11],
                fill=hx(rng.choice(["#7edfe8", "#ffd5a0", "#f7a4c6"]), 220),
            )
    img = overlay(img, vm)
    img = glow(img, (vx, vy), W * 0.045, hx("#bfefff")[:3], 70, 2.2)

    # pipes & AC units on the near wall
    pipes = new_layer()
    pd = ImageDraw.Draw(pipes)
    for x in (W * 0.02, W * 0.035, W * 0.305):
        pd.line([(x, H * 0.1), (x, H * 0.88)], fill=hx("#191126", 230), width=7)
    for i in range(3):
        ay = H * (0.58 + i * 0.08)
        pd.rectangle([W * 0.285, ay, W * 0.322, ay + H * 0.035], fill=hx("#141020"))
    img = overlay(img, pipes)

    # overhead cables
    cables = new_layer()
    cd = ImageDraw.Draw(cables)
    cable_sets = [
        [(0, H * 0.08), (W * 0.28, H * 0.15), (W * 0.52, H * 0.19)],
        [(W, H * 0.05), (W * 0.7, H * 0.14), (W * 0.48, H * 0.18)],
        [(0, H * 0.17), (W * 0.36, H * 0.23), (W * 0.73, H * 0.21), (W, H * 0.14)],
    ]
    for pts in cable_sets:
        cd.line(pts, fill=hx("#06040d", 230), width=3, joint="curve")
    img = overlay(img, cables)

    # wet-ground reflections from the signs
    refl = new_layer()
    rd = ImageDraw.Draw(refl)
    for cx, base, w, color in signs:
        top = H * 0.6 + (base - H * 0.6) * 0.7
        streak_h = rng.uniform(0.12, 0.3) * H
        rd.rounded_rectangle(
            [cx - w * 0.36, top, cx + w * 0.36, min(H, top + streak_h)],
            radius=w * 0.2,
            fill=hx(color, 80),
        )
        for _ in range(5):
            yy = top + rng.uniform(0, streak_h)
            rd.line(
                [(cx - w * 0.5, yy), (cx + w * 0.5, yy)],
                fill=hx(color, rng.randint(30, 70)),
                width=rng.choice([2, 3, 4]),
            )
    img = overlay(img, refl.filter(ImageFilter.GaussianBlur(18)))
    img = glow(img, (vx, H * 0.9), W * 0.08, hx("#bfefff")[:3], 60, 2.4)
    img = glow(img, (dx, H * 0.9), W * 0.1, hx("#ffbe7e")[:3], 50, 2.4)

    # puddle sheen
    sheen = new_layer()
    shd = ImageDraw.Draw(sheen)
    for _ in range(26):
        y = rng.uniform(H * 0.62, H * 0.99)
        x = rng.uniform(W * 0.06, W * 0.94)
        ln = rng.uniform(30, 190)
        shd.line([(x, y), (x + ln, y)], fill=hx(rng.choice(["#ffb3d6", "#9fe8e6", "#ffe0ad"]), rng.randint(12, 40)), width=2)
    img = overlay(img, sheen.filter(ImageFilter.GaussianBlur(2.4)))

    # a bicycle left leaning under the neon
    bike = new_layer()
    bd2 = ImageDraw.Draw(bike)
    bx, by, br = W * 0.585, H * 0.915, H * 0.032
    wheel_l = (bx - br * 1.5, by)
    wheel_r = (bx + br * 1.5, by)
    for (wx, wy) in (wheel_l, wheel_r):
        bd2.ellipse([wx - br, wy - br, wx + br, wy + br], outline=hx("#07050d"), width=6)
        bd2.ellipse([wx - br * 0.2, wy - br * 0.2, wx + br * 0.2, wy + br * 0.2], fill=hx("#07050d"))
    bd2.line([wheel_l, (bx, by - br * 1.9), wheel_r], fill=hx("#07050d"), width=5)
    bd2.line([(bx, by - br * 1.9), (bx - br * 0.6, by - br * 0.6), wheel_l], fill=hx("#07050d"), width=5)
    bd2.line([(bx, by - br * 1.9), (bx + br * 0.35, by - br * 2.6)], fill=hx("#07050d"), width=5)
    bd2.line([(bx + br * 0.35, by - br * 2.6), (bx + br * 1.1, by - br * 2.6)], fill=hx("#07050d"), width=4)
    bd2.line([(bx - br * 0.6, by - br * 0.6), (bx - br * 0.85, by - br * 2.2)], fill=hx("#07050d"), width=4)
    bd2.rectangle([bx - br * 1.0, by - br * 2.4, bx - br * 0.35, by - br * 1.85], fill=hx("#0b0813"))
    img = overlay(img, bike)
    rim_bike = new_layer()
    rbd = ImageDraw.Draw(rim_bike)
    rbd.arc([wheel_l[0] - br, wheel_l[1] - br, wheel_l[0] + br, wheel_l[1] + br], 160, 300, fill=hx("#ff9ecb", 110), width=3)
    rbd.arc([wheel_r[0] - br, wheel_r[1] - br, wheel_r[0] + br, wheel_r[1] + br], 160, 300, fill=hx("#8fe8e4", 90), width=3)
    img = overlay(img, rim_bike.filter(ImageFilter.GaussianBlur(1.2)))
    img = glow(img, (bx, by - br * 1.4), br * 4, hx("#ff92c4")[:3], 14, 2.6)
    # bike reflection
    refl_bike = new_layer()
    rfd = ImageDraw.Draw(refl_bike)
    rfd.ellipse([wheel_l[0] - br, by + br * 0.4, wheel_r[0] + br, by + br * 2.2], fill=hx("#05040a", 120))
    img = overlay(img, refl_bike.filter(ImageFilter.GaussianBlur(9)))

    # foreground bokeh
    bokeh = new_layer()
    bd = ImageDraw.Draw(bokeh)
    for _ in range(32):
        x = rng.uniform(0, W)
        y = rng.uniform(H * 0.68, H * 1.02)
        r = rng.uniform(8, 62)
        bd.ellipse([x - r, y - r, x + r, y + r], fill=hx(rng.choice(["#ffbfe0", "#8ff0e8", "#ffe1ad"]), rng.randint(14, 55)))
    img = overlay(img, bokeh.filter(ImageFilter.GaussianBlur(16)))

    # rain
    rain = new_layer()
    rd = ImageDraw.Draw(rain)
    for _ in range(360):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H)
        ln = rng.uniform(12, 46)
        rd.line([(x, y), (x - ln * 0.14, y + ln)], fill=hx("#cfdcff", rng.randint(8, 30)), width=1)
    img = overlay(img, rain)
    return finish(img, bloom=0.3, grain=0.06, vignette=0.6, saturation=1.12, contrast=1.06)


def scene_sky_islands(rng):
    img = vgrad(
        [
            (0.0, hx("#20224d")[:3]),
            (0.28, hx("#4c4475")[:3]),
            (0.48, hx("#9a6f8f")[:3]),
            (0.62, hx("#e0a194")[:3]),
            (0.72, hx("#f9cfae")[:3]),
            (0.85, hx("#f7dcc6")[:3]),
            (1.0, hx("#8b6c83")[:3]),
        ]
    )
    sun = (W * 0.66, H * 0.52)
    img = glow(img, sun, W * 0.32, hx("#ffe7c4")[:3], 145, 2.1)
    img = glow(img, sun, W * 0.09, hx("#fff6e5")[:3], 200, 2.4)

    # high clouds
    img = soft_blobs(
        img,
        [
            (W * 0.2, H * 0.24, W * 0.3, H * 0.05, hx("#f8cbbb"), 70),
            (W * 0.8, H * 0.18, W * 0.28, H * 0.04, hx("#c8aed2"), 55),
            (W * 0.52, H * 0.32, W * 0.34, H * 0.05, hx("#ffd9c2"), 55),
            (W * 0.1, H * 0.4, W * 0.25, H * 0.04, hx("#d9b5c8"), 50),
        ],
        60,
    )
    img = stars(img, rng, 130, 0.45, (255, 244, 226), 120)

    # cloud sea
    cloud_layer = new_layer()
    cd = ImageDraw.Draw(cloud_layer)
    for i in range(220):
        cx = rng.uniform(-0.1, 1.1) * W
        cy = rng.uniform(0.55, 1.02) * H
        depth = (cy / H - 0.55) / 0.47
        rx = rng.uniform(0.05, 0.18) * W * (0.6 + depth)
        ry = rx * rng.uniform(0.2, 0.36)
        if cy < H * 0.7:
            color = rng.choice(["#f6d3c6", "#e7bfc4", "#caa7ba", "#b18fa9"])
        else:
            color = rng.choice(["#f1d7ce", "#dabfc8", "#b79cb7", "#8f7a9d"])
        cd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=hx(color, rng.randint(35, 100)))
    cloud_layer = cloud_layer.filter(ImageFilter.GaussianBlur(22))
    img = overlay(img, cloud_layer)
    # glowing cloud tops near sun
    img = soft_blobs(
        img,
        [
            (W * 0.58, H * 0.62, W * 0.22, H * 0.035, hx("#ffe6cd"), 110),
            (W * 0.33, H * 0.7, W * 0.3, H * 0.04, hx("#ffd9c8"), 80),
            (W * 0.82, H * 0.7, W * 0.24, H * 0.035, hx("#f9c9c4"), 90),
        ],
        40,
    )

    # floating islands
    def island(cx, cy, size, with_shrine=False, waterfall=False):
        nonlocal img
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        top_w = size
        top_h = size * 0.15
        # rock underside: an irregular, tapering mass
        right = cx + top_w / 2
        left = cx - top_w / 2
        rim = [
            (right, cy + top_h * 0.15),
            (cx + top_w * 0.36, cy + size * 0.18),
            (cx + top_w * 0.4, cy + size * 0.32),
            (cx + top_w * 0.24, cy + size * 0.36),
            (cx + top_w * 0.27, cy + size * 0.52),
            (cx + top_w * 0.1, cy + size * 0.58),
            (cx + top_w * 0.08, cy + size * 0.8),
            (cx, cy + size * 0.92),
            (cx - top_w * 0.06, cy + size * 0.66),
            (cx - top_w * 0.2, cy + size * 0.6),
            (cx - top_w * 0.17, cy + size * 0.42),
            (cx - top_w * 0.33, cy + size * 0.36),
            (cx - top_w * 0.34, cy + size * 0.2),
            (left, cy + top_h * 0.15),
        ]
        d.polygon(rim, fill=hx("#241b30"))
        # vertical cracks rather than shelves
        for _ in range(7):
            t = rng.uniform(0.08, 0.92)
            x0 = lerp(left, right, t)
            x1 = cx + (x0 - cx) * rng.uniform(0.2, 0.55)
            d.line(
                [(x0, cy + top_h * 0.2), (x1, cy + size * rng.uniform(0.25, 0.6))],
                fill=hx("#1b1426", 180),
                width=max(2, int(size * 0.006)),
            )
        # a soft lit edge along one side
        d.line(
            [(left + top_w * 0.02, cy + top_h * 0.25), (cx - top_w * 0.22, cy + size * 0.5), (cx - top_w * 0.06, cy + size * 0.68)],
            fill=hx("#e8a790", 80),
            width=max(2, int(size * 0.008)),
        )
        # earth lip beneath the grass, then the top surface
        d.arc(
            [left, cy - top_h * 0.3, right, cy + top_h * 0.7],
            0,
            180,
            fill=hx("#1a1324"),
            width=max(6, int(size * 0.035)),
        )
        d.ellipse([left, cy - top_h / 2, right, cy + top_h / 2], fill=hx("#5a4450"))
        d.ellipse(
            [left + top_w * 0.025, cy - top_h * 0.38, right - top_w * 0.025, cy + top_h * 0.16],
            fill=hx("#6b5157"),
        )
        d.arc([left, cy - top_h / 2, right, cy + top_h / 2], 180, 360, fill=hx("#ffd2b2"), width=max(3, int(size * 0.012)))
        d.arc([left + top_w * 0.02, cy - top_h * 0.3, right - top_w * 0.02, cy + top_h * 0.55], 20, 160, fill=hx("#2a1e2e"), width=3)
        # scattered trees with real trunks
        for _ in range(max(2, int(size / 65))):
            tx = cx + rng.uniform(-top_w * 0.36, top_w * 0.36)
            th = rng.uniform(size * 0.08, size * 0.17)
            d.line([(tx, cy), (tx + rng.uniform(-6, 6), cy - th)], fill=hx("#1b1426"), width=max(2, int(size * 0.012)))
            for k in range(3):
                bx = tx + rng.uniform(-th * 0.35, th * 0.35)
                by = cy - th * rng.uniform(0.62, 1.0)
                br = th * rng.uniform(0.22, 0.38)
                d.ellipse([bx - br, by - br * 0.9, bx + br, by + br * 0.9], fill=hx("#2a2033"))
                d.arc([bx - br, by - br * 0.9, bx + br, by + br * 0.9], 200, 330, fill=hx("#f0b59c", 100), width=2)
        # a little shrine with a warm window
        if with_shrine:
            sx = cx + top_w * 0.1
            sy = cy - size * 0.075
            sw = size * 0.2
            d.rectangle([sx - sw * 0.4, sy - sw * 0.28, sx + sw * 0.4, sy + sw * 0.04], fill=hx("#1c1424"))
            d.polygon(
                [(sx - sw * 0.62, sy - sw * 0.24), (sx, sy - sw * 0.62), (sx + sw * 0.62, sy - sw * 0.24)],
                fill=hx("#171020"),
            )
            d.rectangle([sx - sw * 0.14, sy - sw * 0.2, sx + sw * 0.14, sy - sw * 0.03], fill=hx("#ffd59b"))
            d.line([(sx, sy - sw * 0.62), (sx, sy - sw * 0.78)], fill=hx("#171020"), width=3)
        # hanging vines
        for _ in range(int(size / 80)):
            vx = cx + rng.uniform(-top_w * 0.35, top_w * 0.35)
            vl = rng.uniform(size * 0.1, size * 0.3)
            d.line([(vx, cy + top_h * 0.1), (vx + rng.uniform(-10, 10), cy + vl)], fill=hx("#1f1829", 190), width=2)
        img = overlay(img, layer)
        if waterfall:
            wf = new_layer()
            wd = ImageDraw.Draw(wf)
            wx = cx - top_w * 0.18
            wd.line([(wx, cy), (wx + 4, cy + size * 0.95)], fill=hx("#fff1e4", 110), width=max(4, int(size * 0.014)))
            wd.line([(wx + 10, cy + size * 0.05), (wx + 16, cy + size * 0.8)], fill=hx("#ffd9cd", 60), width=3)
            wf = wf.filter(ImageFilter.GaussianBlur(4))
            img = overlay(img, wf)
            img = glow(img, (wx, cy + size * 0.5), size * 0.16, hx("#ffe3d4")[:3], 55, 2.4)
        # warm lantern lights along the top
        for _ in range(int(size / 45)):
            lx = cx + rng.uniform(-top_w * 0.4, top_w * 0.4)
            ly = cy - rng.uniform(size * 0.01, size * 0.09)
            img = glow(img, (lx, ly), size * 0.028, hx("#ffd7a0")[:3], rng.randint(90, 170), 2.2)
        return layer

    island(W * 0.21, H * 0.5, W * 0.33, with_shrine=True, waterfall=True)
    island(W * 0.7, H * 0.41, W * 0.18)
    island(W * 0.45, H * 0.61, W * 0.1)
    island(W * 0.88, H * 0.56, W * 0.14)
    island(W * 0.055, H * 0.4, W * 0.07)
    # drifting rocks
    for _ in range(7):
        rx = rng.uniform(W * 0.3, W * 0.82)
        ry = rng.uniform(H * 0.5, H * 0.8)
        rs = rng.uniform(8, 26)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.polygon(
            [
                (rx - rs, ry),
                (rx - rs * 0.4, ry - rs * 0.5),
                (rx + rs * 0.6, ry - rs * 0.35),
                (rx + rs, ry + rs * 0.2),
                (rx + rs * 0.2, ry + rs * 0.9),
                (rx - rs * 0.7, ry + rs * 0.5),
            ],
            fill=hx("#251c31", 225),
        )
        d.line([(rx - rs * 0.8, ry + rs * 0.1), (rx + rs * 0.7, ry - rs * 0.1)], fill=hx("#f0b49d", 60), width=2)
        img = overlay(img, layer)

    # floating lanterns
    for _ in range(34):
        x = rng.uniform(W * 0.05, W * 0.95)
        y = rng.uniform(H * 0.34, H * 0.75)
        img = glow(img, (x, y), rng.uniform(10, 22), hx("#ffe0ad")[:3], rng.randint(50, 130), 2.3)
    for _ in range(10):
        x = rng.uniform(W * 0.05, W * 0.95)
        y = rng.uniform(H * 0.34, H * 0.72)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.rectangle([x - 5, y - 6, x + 5, y + 6], fill=hx("#ffcf95", 220))
        img = overlay(img, layer)
        img = glow(img, (x, y), 26, hx("#ffcf95")[:3], 120, 2.2)

    # birds
    bird = new_layer()
    bd = ImageDraw.Draw(bird)
    for _ in range(7):
        x, y = rng.uniform(W * 0.36, W * 0.62), rng.uniform(H * 0.2, H * 0.3)
        s = rng.uniform(14, 26)
        bd.arc([x - s, y - s * 0.5, x, y + s * 0.5], 200, 340, fill=hx("#3a2c3f", 190), width=4)
        bd.arc([x, y - s * 0.5, x + s, y + s * 0.5], 200, 340, fill=hx("#3a2c3f", 190), width=4)
    img = overlay(img, bird)

    # cloud banks that wrap the roots of the islands
    mist = new_layer()
    md = ImageDraw.Draw(mist)
    for _ in range(140):
        x = rng.uniform(-0.1, 1.1) * W
        y = rng.uniform(H * 0.6, H * 0.96)
        rx = rng.uniform(0.07, 0.26) * W
        ry = rx * rng.uniform(0.12, 0.26)
        md.ellipse(
            [x - rx, y - ry, x + rx, y + ry],
            fill=hx(rng.choice(["#fbe0d4", "#f2d2cf", "#dfbecb", "#c8a8bf"]), rng.randint(40, 110)),
        )
    img = overlay(img, mist.filter(ImageFilter.GaussianBlur(30)))
    img = soft_blobs(
        img,
        [
            (W * 0.16, H * 0.81, W * 0.28, H * 0.06, hx("#fff0e2"), 150),
            (W * 0.5, H * 0.86, W * 0.22, H * 0.05, hx("#fde0d6"), 130),
            (W * 0.78, H * 0.8, W * 0.22, H * 0.05, hx("#ffe8da"), 140),
            (W * 0.04, H * 0.72, W * 0.16, H * 0.03, hx("#f8d7cf"), 110),
            (W * 0.95, H * 0.7, W * 0.14, H * 0.03, hx("#ffe3d4"), 100),
        ],
        26,
    )
    # waterfall mist
    img = glow(img, (W * 0.14, H * 0.7), W * 0.12, hx("#ffe9dc")[:3], 80, 2.2)
    return finish(img, bloom=0.2, grain=0.045, vignette=0.5)


def draw_lighthouse(layer, cx, base_y, h):
    d = ImageDraw.Draw(layer)
    w = h * 0.24
    d.polygon(
        [
            (cx - w * 0.55, base_y),
            (cx + w * 0.55, base_y),
            (cx + w * 0.33, base_y - h * 0.86),
            (cx - w * 0.33, base_y - h * 0.86),
        ],
        fill=hx("#131320"),
    )
    # stripes (subtle, moonlit)
    for i in range(4):
        y = base_y - h * (0.12 + i * 0.17)
        d.rectangle([cx - w * 0.5 + i * 2, y, cx + w * 0.5 - i * 2, y + h * 0.055], fill=hx("#26303a", 180))
    # gallery
    d.rectangle([cx - w * 0.55, base_y - h * 0.93, cx + w * 0.55, base_y - h * 0.86], fill=hx("#101019"))
    # lantern room
    d.rectangle([cx - w * 0.34, base_y - h * 1.02, cx + w * 0.34, base_y - h * 0.93], fill=hx("#ffdf9e", 235))
    d.polygon(
        [(cx - w * 0.45, base_y - h * 1.02), (cx, base_y - h * 1.16), (cx + w * 0.45, base_y - h * 1.02)],
        fill=hx("#12121d"),
    )
    # railing
    for i in range(-2, 3):
        d.line([(cx + i * w * 0.22, base_y - h * 1.02), (cx + i * w * 0.22, base_y - h * 0.93)], fill=hx("#0d0d16"), width=3)


def scene_lighthouse(rng):
    horizon = H * 0.66
    img = vgrad(
        [
            (0.0, hx("#030716")[:3]),
            (0.25, hx("#071129")[:3]),
            (0.5, hx("#0c2038")[:3]),
            (0.66, hx("#173a49")[:3]),
            (0.72, hx("#1b4b55")[:3]),
            (1.0, hx("#06131f")[:3]),
        ]
    )
    img = stars(img, rng, 700, 0.68, (235, 242, 255), 235)

    # milky way diagonal haze + dense stars
    band = new_layer()
    bd = ImageDraw.Draw(band)
    bd.polygon(
        [(0, H * 0.05), (W * 0.18, H * 0.01), (W * 0.93, H * 0.5), (W, H * 0.57), (W * 0.86, H * 0.6), (W * 0.06, H * 0.15)],
        fill=hx("#aebfdf", 7),
    )
    band = band.filter(ImageFilter.GaussianBlur(90))
    img = screen(img, band.convert("RGB"))
    band_stars = new_layer()
    bsd = ImageDraw.Draw(band_stars)
    for _ in range(900):
        t = rng.random()
        x = t * W
        center = H * (0.06 + t * 0.48)
        y = rng.gauss(center, H * 0.028)
        if 0 < y < H * 0.62:
            r = rng.choice([1, 1, 1, 2])
            a = rng.randint(40, 170)
            bsd.ellipse([x - r, y - r, x + r, y + r], fill=hx(rng.choice(["#ffffff", "#cfdcff", "#ffe9d9"]), a))
    img = overlay(img, band_stars)
    # sea
    sea = vgrad(
        [
            (0.0, hx("#1b4050")[:3]),
            (0.35, hx("#0f2a38")[:3]),
            (1.0, hx("#06121c")[:3]),
        ]
    ).crop((0, int(horizon), W, H))
    img.paste(sea, (0, int(horizon)))
    # horizon glow
    img = glow(img, (W * 0.45, horizon), W * 0.4, hx("#4d8b95")[:3], 80, 2.4)
    # water shimmer
    shimmer = new_layer()
    sd = ImageDraw.Draw(shimmer)
    for _ in range(160):
        y = rng.uniform(horizon, H)
        t = (y - horizon) / (H - horizon)
        x = rng.uniform(0, W)
        ln = rng.uniform(10, 90) * (0.4 + t)
        sd.line([(x, y), (x + ln, y)], fill=hx(rng.choice(["#9fd4d8", "#ffe6b8", "#7ea9bd"]), rng.randint(10, 45)), width=rng.choice([1, 2, 2]))
    img = overlay(img, shimmer.filter(ImageFilter.GaussianBlur(1.2)))

    # star reflection
    refl = new_layer()
    rd = ImageDraw.Draw(refl)
    for _ in range(150):
        y = rng.uniform(horizon, H * 0.98)
        x = rng.uniform(W * 0.1, W * 0.9)
        rd.line([(x, y), (x + rng.uniform(2, 26), y)], fill=hx("#dbe8ff", rng.randint(20, 80)), width=2)
    img = overlay(img, refl.filter(ImageFilter.GaussianBlur(2)))

    # cliffs
    cliff = new_layer()
    cd = ImageDraw.Draw(cliff)
    cd.polygon(
        [(W * 0.55, H), (W * 0.63, H * 0.82), (W * 0.7, H * 0.76), (W * 0.78, H * 0.74), (W * 0.9, H * 0.8), (W, H * 0.78), (W, H)],
        fill=hx("#080b12"),
    )
    cd.polygon(
        [(W * 0.9, H), (W * 0.88, H * 0.9), (W * 0.98, H * 0.88), (W, H)],
        fill=hx("#0b0e16"),
    )
    img = overlay(img, cliff)
    img = glow(img, (W * 0.68, H * 0.8), W * 0.07, hx("#ffca80")[:3], 70, 2.6)  # keeper's house

    # beams
    beam = new_layer()
    bd = ImageDraw.Draw(beam)
    lx, ly = W * 0.79, H * 0.5
    bd.polygon([(lx, ly), (W * 0.08, H * 0.39), (W * 0.06, H * 0.435)], fill=hx("#ffe0a0", 14))
    bd.polygon([(lx, ly), (W * 0.98, H * 0.34), (W * 0.98, H * 0.39)], fill=hx("#ffe0a0", 9))
    img = screen(img, beam.filter(ImageFilter.GaussianBlur(34)).convert("RGB"))

    # lighthouse
    lh = new_layer()
    draw_lighthouse(lh, W * 0.79, H * 0.76, H * 0.24)
    img = overlay(img, lh)
    img = glow(img, (W * 0.79, H * 0.5), W * 0.07, hx("#ffd894")[:3], 160, 2.0)

    # shooting star
    ss = new_layer()
    sd = ImageDraw.Draw(ss)
    x0, y0 = W * 0.3, H * 0.08
    sd.line([(x0, y0), (x0 + W * 0.13, y0 - H * 0.05)], fill=hx("#ffffff", 200), width=4)
    ss = ss.filter(ImageFilter.GaussianBlur(2))
    img = screen(img, ss.convert("RGB"))
    return finish(img, bloom=0.26, grain=0.055, vignette=0.6, saturation=1.02)


def aurora_band(img, rng, base_y, color, amplitude=120, thickness=180, alpha=55, phase=0.0):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    n = 90
    top, bottom = [], []
    for i in range(n + 1):
        t = i / n
        x = t * W
        y = base_y + math.sin(t * math.pi * 2.2 + phase) * amplitude + math.sin(t * math.pi * 6 + phase) * amplitude * 0.25
        top.append((x, y - thickness * (0.35 + 0.3 * math.sin(t * math.pi * 3))))
        bottom.append((x, y + thickness * (0.65 + 0.25 * math.cos(t * math.pi * 2.5))))
    d.polygon(top + list(reversed(bottom)), fill=hx(color, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(46))
    return screen(img, layer.convert("RGB"))


def god_rays(img, origin, color, count=7, length=1.0, alpha=22, spread=0.5):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    ox, oy = origin
    for _ in range(count):
        angle = math.pi / 2 + random.uniform(-spread, spread)
        width = random.uniform(0.02, 0.06) * W
        end_x = ox + math.cos(angle) * H * length
        end_y = oy + math.sin(angle) * H * length
        d.polygon(
            [
                (ox - width / 2, oy),
                (ox + width / 2, oy),
                (end_x + width * 1.5, end_y),
                (end_x - width * 1.5, end_y),
            ],
            fill=hx(color, alpha),
        )
    return screen(img, layer.filter(ImageFilter.GaussianBlur(34)).convert("RGB"))


def fireworks(img, rng, center, radius, color, rays=70):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    cx, cy = center
    for _ in range(rays):
        angle = rng.uniform(0, math.tau)
        r0 = radius * rng.uniform(0.18, 0.3)
        r1 = radius * rng.uniform(0.65, 1.0)
        alpha = rng.randint(90, 220)
        x0, y0 = cx + math.cos(angle) * r0, cy + math.sin(angle) * r0
        x1, y1 = cx + math.cos(angle) * r1, cy + math.sin(angle) * r1
        d.line([(x0, y0), (x1, y1)], fill=hx(color, alpha), width=rng.choice([2, 3]))
        d.ellipse([x1 - 4, y1 - 4, x1 + 4, y1 + 4], fill=hx("#fff6e8", min(255, alpha + 30)))
    # inner shower
    for _ in range(24):
        angle = rng.uniform(0, math.tau)
        rr = radius * rng.uniform(0.05, 0.45)
        x, y = cx + math.cos(angle) * rr, cy + math.sin(angle) * rr
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=hx(color, rng.randint(50, 120)))
    img = overlay(img, layer)
    img = screen(img, layer.filter(ImageFilter.GaussianBlur(22)).convert("RGB").point(lambda v: int(v * 0.55)))
    img = glow(img, center, radius * 1.2, hx(color)[:3], 50, 2.2)
    # smoke
    img = soft_blobs(
        img,
        [
            (cx, cy, radius * 1.1, radius * 0.9, hx("#6f6077"), 16),
            (cx + radius * 0.2, cy + radius * 0.2, radius * 0.9, radius * 0.7, hx("#9a7d8b"), 12),
        ],
        50,
    )
    return img


def scene_bamboo(rng):
    img = vgrad(
        [
            (0.0, hx("#08171a")[:3]),
            (0.35, hx("#0d2727")[:3]),
            (0.62, hx("#164036")[:3]),
            (0.8, hx("#245444")[:3]),
            (1.0, hx("#081512")[:3]),
        ]
    )
    img = stars(img, rng, 200, 0.5, (222, 246, 224), 160)
    img = glow(img, (W * 0.68, H * 0.24), W * 0.32, hx("#d8f2d0")[:3], 140, 2.3)
    moon = new_layer()
    md = ImageDraw.Draw(moon)
    md.ellipse([W * 0.68 - 165, H * 0.24 - 165, W * 0.68 + 165, H * 0.24 + 165], fill=hx("#f2f8e4"))
    md.ellipse([W * 0.645, H * 0.21, W * 0.675, H * 0.235], fill=hx("#e4edd6"))
    md.ellipse([W * 0.703, H * 0.258, W * 0.723, H * 0.276], fill=hx("#e9f1dc"))
    img = overlay(img, moon)
    img = ridge(img, rng, H * 0.72, H * 0.13, hx("#123029")[:3], 0.4, 0, 8)
    img = haze(img, 0.6, 0.85, hx("#8fbc9f")[:3], 0, 55)

    def stalk_layer(seed, count, alpha, color_choices, blur=0):
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        srng = random.Random(seed)
        for _ in range(count):
            x = srng.uniform(-0.05, 1.05) * W
            width = srng.uniform(8, 42)
            lean = srng.uniform(-34, 34)
            top = -50
            bottom = H + 50
            pts = [(x, bottom), (x + lean * 0.4, H * 0.5), (x + lean, top)]
            d.line(pts, fill=hx(srng.choice(color_choices), alpha), width=int(width), joint="curve")
            # nodes
            for k in range(7):
                yy = top + (bottom - top) * (k + srng.uniform(0.2, 0.8)) / 7
                t = (yy - top) / (bottom - top)
                xx = x + lean * (1 - t) ** 0.7
                d.line(
                    [(xx - width * 0.65, yy), (xx + width * 0.65, yy)],
                    fill=hx("#1a3a2f", min(255, alpha)),
                    width=max(2, int(width * 0.12)),
                )
            # leaves
            for _ in range(srng.randint(2, 5)):
                ly = srng.uniform(H * 0.12, H * 0.62)
                side = srng.choice([-1, 1])
                lx = x + lean * 0.3
                ln = srng.uniform(50, 130)
                d.polygon(
                    [
                        (lx, ly),
                        (lx + side * ln, ly - srng.uniform(16, 50)),
                        (lx + side * ln * 0.9, ly - srng.uniform(4, 20)),
                        (lx, ly + 6),
                    ],
                    fill=hx(srng.choice(["#2d5c42", "#3b6f4c", "#24503a"]), min(255, alpha)),
                )
        if blur:
            layer = layer.filter(ImageFilter.GaussianBlur(blur))
        return layer

    img = overlay(img, stalk_layer(7, 16, 150, ["#1a3a31", "#20453a", "#16342c"], 3))
    img = overlay(img, stalk_layer(19, 12, 220, ["#122b25", "#1a3a2f", "#0f2620"], 0))
    # fireflies
    for _ in range(80):
        x = rng.uniform(0, W)
        y = rng.uniform(H * 0.35, H * 0.95)
        r = rng.uniform(2, 7)
        img = glow(img, (x, y), r * 6, hx(rng.choice(["#f6f0a8", "#d7f5a8", "#ffe9b0"]))[:3], rng.randint(40, 120), 2.4)
    # foreground fog and dark stalks
    img = soft_blobs(
        img,
        [
            (W * 0.3, H * 0.88, W * 0.36, H * 0.07, hx("#9ec9ae"), 35),
            (W * 0.75, H * 0.93, W * 0.32, H * 0.06, hx("#b9dcc2"), 30),
        ],
        50,
    )
    img = overlay(img, stalk_layer(31, 3, 255, ["#0b201b", "#0d241e"], 4))
    return finish(img, bloom=0.24, grain=0.05, vignette=0.45)


def scene_rooftop(rng):
    img = vgrad(
        [
            (0.0, hx("#4c6ea4")[:3]),
            (0.28, hx("#8b8bb4")[:3]),
            (0.5, hx("#d3a7ad")[:3]),
            (0.66, hx("#f6c4a3")[:3]),
            (0.78, hx("#ffd9a9")[:3]),
            (0.86, hx("#c98f83")[:3]),
            (1.0, hx("#2a2030")[:3]),
        ]
    )
    sun = (W * 0.73, H * 0.6)
    img = glow(img, sun, W * 0.3, hx("#ffe6bc")[:3], 120, 2.2)
    img = glow(img, sun, W * 0.06, hx("#fff4d9")[:3], 190, 2.4)

    def cumulus(cx, cy, width, height):
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        # underside shadow
        for _ in range(12):
            bx = cx + rng.uniform(-0.42, 0.42) * width
            by = cy + rng.uniform(0.0, 0.14) * height
            rx = width * rng.uniform(0.18, 0.32)
            ry = height * rng.uniform(0.16, 0.32)
            d.ellipse(
                [bx - rx, by - ry, bx + rx, by + ry],
                fill=mix(hx("#a27c96")[:3], hx("#d2a8ae")[:3], rng.random()) + (255,),
            )
        # body puffs
        for _ in range(20):
            bx = cx + rng.uniform(-0.38, 0.38) * width
            by = cy - abs(rng.gauss(0, 0.17)) * height
            rx = width * rng.uniform(0.11, 0.24)
            ry = height * rng.uniform(0.45, 0.8)
            t = min(1.0, max(0.0, 0.45 - (by - cy) / height * 0.9 + rng.uniform(-0.12, 0.12)))
            color = mix(hx("#b98fa3")[:3], hx("#ffe8d6")[:3], t)
            d.ellipse([bx - rx, by - ry, bx + rx, by + ry], fill=color + (255,))
        # sunlit crown
        for _ in range(9):
            bx = cx + rng.uniform(-0.28, 0.3) * width
            by = cy - height * rng.uniform(0.28, 0.52)
            rx = width * rng.uniform(0.05, 0.12)
            d.ellipse(
                [bx - rx, by - rx * 0.9, bx + rx, by + rx * 0.9],
                fill=mix(hx("#f6cbb8")[:3], hx("#fff8ea")[:3], rng.uniform(0.4, 0.9)) + (255,),
            )
        return layer.filter(ImageFilter.GaussianBlur(5))

    img = glow(img, (W * 0.68, H * 0.36), W * 0.22, hx("#ffe3c6")[:3], 60, 2.2)
    img = overlay(img, cumulus(W * 0.17, H * 0.44, W * 0.42, H * 0.22))
    img = overlay(img, cumulus(W * 0.56, H * 0.29, W * 0.26, H * 0.13))
    img = overlay(img, cumulus(W * 0.86, H * 0.47, W * 0.36, H * 0.2))
    img = overlay(img, cumulus(W * 0.34, H * 0.16, W * 0.2, H * 0.1))
    img = soft_blobs(
        img,
        [
            (W * 0.17, H * 0.37, W * 0.17, H * 0.03, hx("#fff1df"), 65),
            (W * 0.56, H * 0.24, W * 0.1, H * 0.018, hx("#fff4e4"), 60),
            (W * 0.86, H * 0.41, W * 0.13, H * 0.025, hx("#ffe9d4"), 55),
        ],
        24,
    )
    # city down below
    city = new_layer()
    cd = ImageDraw.Draw(city)
    for _ in range(70):
        bx = rng.uniform(0, W)
        bw = rng.uniform(0.015, 0.05) * W
        bh = rng.uniform(0.02, 0.08) * H
        by = H * 0.76
        cd.rectangle([bx, by - bh, bx + bw, by], fill=hx("#51405d", 210))
        for _ in range(rng.randint(1, 3)):
            wx = bx + rng.uniform(2, max(3, bw - 6))
            wy = by - bh + rng.uniform(2, max(3, bh - 6))
            cd.rectangle([wx, wy, wx + 3, wy + 4], fill=hx("#ffd6a0", rng.randint(60, 160)))
    img = overlay(img, city.filter(ImageFilter.GaussianBlur(2.5)))
    img = haze(img, 0.7, 0.8, hx("#f6c4a3")[:3], 0, 110)

    # rooftop foreground
    roof = new_layer()
    rd = ImageDraw.Draw(roof)
    rd.polygon([(0, H * 0.83), (W, H * 0.8), (W, H), (0, H)], fill=hx("#231b2b"))
    rd.line([(0, H * 0.826), (W, H * 0.796)], fill=hx("#f1b391", 90), width=3)
    # railing
    rail_y = H * 0.735
    rd.line([(0, rail_y), (W * 0.62, rail_y - H * 0.012)], fill=hx("#160f1d"), width=9)
    rd.line([(0, rail_y + H * 0.058), (W * 0.62, rail_y + H * 0.046)], fill=hx("#160f1d"), width=5)
    for i in range(9):
        x = W * 0.02 + i * W * 0.07
        rd.line([(x, rail_y), (x, rail_y + H * 0.06)], fill=hx("#160f1d"), width=4)
    # water tank
    tx, ty, tw, th = W * 0.83, H * 0.74, W * 0.13, H * 0.12
    rd.rectangle([tx - tw / 2, ty - th, tx + tw / 2, ty], fill=hx("#1d1625"))
    rd.ellipse([tx - tw / 2, ty - th - 18, tx + tw / 2, ty - th + 18], fill=hx("#1d1625"))
    for i in range(3):
        rd.line([(tx - tw / 2 + 12 + i * tw * 0.35, ty), (tx - tw / 2 + 12 + i * tw * 0.35, ty + H * 0.04)], fill=hx("#150f1c"), width=4)
    # utility pole + wires
    px, py = W * 0.9, H * 0.74
    rd.rectangle([px - 8, py - H * 0.32, px + 8, py], fill=hx("#160f1d"))
    rd.line([(px - 46, py - H * 0.28), (px + 46, py - H * 0.28)], fill=hx("#160f1d"), width=7)
    rd.line([(px - 36, py - H * 0.32), (px + 36, py - H * 0.32)], fill=hx("#160f1d"), width=5)
    img = overlay(img, roof)
    wires = new_layer()
    wd = ImageDraw.Draw(wires)
    for offset in (0, 18, 36):
        wd.line(
            [(0, H * 0.2 + offset), (W * 0.3, H * 0.26 + offset), (W * 0.6, H * 0.3 + offset), (px, py - H * 0.28 + offset)],
            fill=hx("#2a2030", 190),
            width=2,
        )
    img = overlay(img, wires)
    # potted plants on the roof edge
    plants = new_layer()
    pd = ImageDraw.Draw(plants)
    for i, (fx, fs) in enumerate([(0.2, 1.0), (0.27, 0.7)]):
        bx = W * fx
        by = H * 0.80
        pd.polygon([(bx - 22 * fs, by), (bx + 22 * fs, by), (bx + 16 * fs, by + 30 * fs), (bx - 16 * fs, by + 30 * fs)], fill=hx("#191320"))
        for _ in range(6):
            ang = rng.uniform(-2.4, -0.7)
            ln = rng.uniform(28, 60) * fs
            ex, ey = bx + math.cos(ang) * ln, by + math.sin(ang) * ln
            pd.line([(bx, by), (ex, ey)], fill=hx("#1b1621"), width=3)
            pd.ellipse([ex - 10 * fs, ey - 5 * fs, ex + 10 * fs, ey + 5 * fs], fill=hx("#201a26"))
    img = overlay(img, plants)
    # birds
    bird = new_layer()
    bd = ImageDraw.Draw(bird)
    for _ in range(9):
        x, y = rng.uniform(W * 0.3, W * 0.75), rng.uniform(H * 0.16, H * 0.32)
        s = rng.uniform(9, 20)
        bd.arc([x - s, y - s * 0.5, x, y + s * 0.5], 200, 340, fill=hx("#4a3a4a", 200), width=3)
        bd.arc([x, y - s * 0.5, x + s, y + s * 0.5], 200, 340, fill=hx("#4a3a4a", 200), width=3)
    img = overlay(img, bird)
    # lens flare
    for i, (fx, fy, fr, col) in enumerate([(0.55, 0.62, 22, "#ffe9c8"), (0.43, 0.52, 50, "#ffd9b8"), (0.3, 0.42, 34, "#ffe6d0")]):
        img = glow(img, (W * fx, H * fy), fr, hx(col)[:3], 45, 2.0)
    img = petals(img, rng, 16, (W * 0.45, H * 0.1, W, H * 0.7), 4, (4, 10))
    return finish(img, bloom=0.22, grain=0.05, vignette=0.45, saturation=1.02)


def scene_snow_village(rng):
    img = vgrad(
        [
            (0.0, hx("#060d22")[:3]),
            (0.28, hx("#0e2142")[:3]),
            (0.5, hx("#1d3a5e")[:3]),
            (0.68, hx("#3c5474")[:3]),
            (0.8, hx("#6d7f98")[:3]),
            (1.0, hx("#18233a")[:3]),
        ]
    )
    img = stars(img, rng, 500, 0.55)
    img = aurora_band(img, rng, H * 0.18, "#7ef0b0", 70, 190, 40, 0.3)
    img = aurora_band(img, rng, H * 0.23, "#a9a0f0", 90, 150, 40, 2.1)
    img = aurora_band(img, rng, H * 0.16, "#c9f7e0", 50, 120, 28, 1.1)
    img = ridge(img, rng, H * 0.66, H * 0.2, hx("#22364f")[:3], 0.35, 0, 6)
    img = haze(img, 0.55, 0.7, hx("#9db2cc")[:3], 0, 80)
    # snow ground
    ground = vgrad(
        [
            (0.0, hx("#aebfd4")[:3]),
            (0.3, hx("#8598b4")[:3]),
            (1.0, hx("#2a3854")[:3]),
        ]
    )
    mask = Image.new("L", (W, H), 0)
    gm = ImageDraw.Draw(mask)
    gm.polygon([(0, H * 0.7), (W * 0.4, H * 0.66), (W, H * 0.72), (W, H), (0, H)], fill=255)
    img = Image.composite(ground, img, mask)
    img = haze(img, 0.68, 0.8, hx("#c3d2e6")[:3], 0, 60)

    # pine trees
    def pine(x, base_y, height, dark="#172437"):
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.polygon([(x - height * 0.05, base_y), (x + height * 0.05, base_y), (x, base_y - height * 0.7)], fill=hx(dark))
        for i in range(4):
            yy = base_y - height * (0.22 + i * 0.17)
            ww = height * (0.32 - i * 0.055)
            d.polygon(
                [(x - ww, yy), (x, yy - height * 0.26), (x + ww, yy), (x, yy - height * 0.08)],
                fill=hx(dark),
            )
            d.line(
                [(x - ww * 0.8, yy - height * 0.03), (x, yy - height * 0.15), (x + ww * 0.8, yy - height * 0.03)],
                fill=hx("#c8d7e8", 190),
                width=3,
            )
        return layer

    for _ in range(9):
        x = rng.uniform(W * 0.45, W)
        y = rng.uniform(H * 0.7, H * 0.82)
        img = overlay(img, pine(x, y, rng.uniform(H * 0.1, H * 0.24)))

    def house(cx, base_y, w, h, light="#ffca86"):
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.rectangle([cx - w / 2, base_y - h, cx + w / 2, base_y], fill=hx("#1b2133"))
        d.polygon(
            [(cx - w * 0.68, base_y - h * 0.92), (cx, base_y - h * 1.45), (cx + w * 0.68, base_y - h * 0.92)],
            fill=hx("#141a2a"),
        )
        # snow caps
        d.polygon(
            [(cx - w * 0.7, base_y - h * 0.9), (cx, base_y - h * 1.5), (cx + w * 0.7, base_y - h * 0.9), (cx + w * 0.56, base_y - h * 0.84), (cx, base_y - h * 1.36), (cx - w * 0.56, base_y - h * 0.84)],
            fill=hx("#dbe6f2"),
        )
        d.rectangle([cx - w * 0.42, base_y - h * 0.86, cx + w * 0.42, base_y - h * 0.78], fill=hx("#c5d5e6"))
        d.rectangle([cx - w * 0.16, base_y - h * 0.55, cx + w * 0.16, base_y - h * 0.3], fill=hx(light, 245))
        d.rectangle([cx - w * 0.46, base_y - h * 0.52, cx - w * 0.28, base_y - h * 0.36], fill=hx(light, 210))
        d.rectangle([cx + w * 0.28, base_y - h * 0.52, cx + w * 0.46, base_y - h * 0.36], fill=hx(light, 210))
        d.line([(cx + w * 0.3, base_y - h * 1.3), (cx + w * 0.3, base_y - h * 1.7)], fill=hx("#1b2133"), width=4)
        return layer

    # distant row, partly lost in the snowfall
    for fx, fy, fw, fh in [(0.24, 0.82, 0.08, 0.04), (0.5, 0.8, 0.1, 0.045), (0.74, 0.83, 0.09, 0.04), (0.9, 0.8, 0.07, 0.035)]:
        img = overlay(img, house(W * fx, H * fy, W * fw, H * fh * 2.0).convert("RGBA"))
    img = haze(img, 0.72, 0.86, hx("#aebfd6")[:3], 0, 55)
    houses = [
        (0.16, 0.9, 0.11, 0.055),
        (0.33, 0.94, 0.15, 0.07),
        (0.52, 0.91, 0.11, 0.055),
        (0.69, 0.95, 0.14, 0.065),
        (0.86, 0.9, 0.12, 0.058),
    ]
    for fx, fy, fw, fh in houses:
        img = overlay(img, house(W * fx, H * fy, W * fw, H * fh * 2.2))
        img = glow(img, (W * fx, H * fy - H * fh * 1.3), W * 0.05, hx("#ffc484")[:3], 55, 2.4)
    # smoke
    for fx, fy in [(0.35, 0.72), (0.71, 0.74)]:
        img = soft_blobs(img, [(W * fx, H * fy, W * 0.025, H * 0.035, hx("#c1cede"), 24)], 26)
    # snow drifts in the foreground
    img = soft_blobs(
        img,
        [
            (W * 0.12, H * 0.99, W * 0.3, H * 0.06, hx("#dbe8f4"), 130),
            (W * 0.55, H * 1.01, W * 0.35, H * 0.05, hx("#e8f2fb"), 120),
            (W * 0.9, H * 0.98, W * 0.24, H * 0.05, hx("#cfdff0"), 120),
        ],
        22,
    )
    # snowfall
    snow = new_layer()
    sd = ImageDraw.Draw(snow)
    for _ in range(420):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        r = rng.uniform(1, 4)
        sd.ellipse([x - r, y - r, x + r, y + r], fill=hx("#eef6ff", rng.randint(90, 220)))
    img = overlay(img, snow)
    bokeh = new_layer()
    bd = ImageDraw.Draw(bokeh)
    for _ in range(30):
        x, y = rng.uniform(0, W), rng.uniform(H * 0.2, H)
        r = rng.uniform(8, 30)
        bd.ellipse([x - r, y - r, x + r, y + r], fill=hx("#dceaff", rng.randint(20, 60)))
    img = overlay(img, bokeh.filter(ImageFilter.GaussianBlur(9)))
    return finish(img, bloom=0.2, grain=0.05, vignette=0.55)


def scene_festival(rng):
    img = vgrad(
        [
            (0.0, hx("#070719")[:3]),
            (0.35, hx("#111031")[:3]),
            (0.6, hx("#251a42")[:3]),
            (0.72, hx("#3a2447")[:3]),
            (0.8, hx("#161027")[:3]),
            (1.0, hx("#080611")[:3]),
        ]
    )
    img = stars(img, rng, 430, 0.6, (245, 238, 255), 210)
    img = fireworks(img, rng, (W * 0.26, H * 0.24), W * 0.11, "#ffa3c9", 80)
    img = fireworks(img, rng, (W * 0.62, H * 0.17), W * 0.14, "#ffd28f", 90)
    img = fireworks(img, rng, (W * 0.82, H * 0.32), W * 0.09, "#8fe8df", 70)
    img = fireworks(img, rng, (W * 0.45, H * 0.38), W * 0.07, "#c7a8ff", 60)
    # distant haze of smoke
    img = soft_blobs(
        img,
        [
            (W * 0.3, H * 0.3, W * 0.26, H * 0.08, hx("#7c6a80"), 22),
            (W * 0.7, H * 0.28, W * 0.3, H * 0.08, hx("#8b7488"), 20),
        ],
        60,
    )
    # town skyline
    town = new_layer()
    td = ImageDraw.Draw(town)
    for _ in range(55):
        bx = rng.uniform(0, W)
        bw = rng.uniform(0.02, 0.06) * W
        bh = rng.uniform(0.02, 0.09) * H
        by = H * 0.72
        td.rectangle([bx, by - bh, bx + bw, by + H * 0.02], fill=hx("#120e1e"))
        if rng.random() < 0.7:
            td.rectangle([bx + bw * 0.2, by - bh * 0.6, bx + bw * 0.5, by - bh * 0.4], fill=hx("#ffcf92", rng.randint(80, 180)))
    # torii on the left bank
    draw_torii(town, W * 0.12, H * 0.73, H * 0.15, "#120e1e", 255, "#ffb3c4")
    # bridge
    td.arc([W * 0.38, H * 0.63, W * 0.68, H * 0.82], 180, 360, fill=hx("#171021"), width=12)
    td.line([(W * 0.38, H * 0.725), (W * 0.68, H * 0.725)], fill=hx("#171021"), width=6)
    for i in range(9):
        x = W * (0.4 + i * 0.035)
        td.line([(x, H * 0.725), (x, H * 0.69 + math.sin(i) * 4)], fill=hx("#171021"), width=3)
    img = overlay(img, town)
    for _ in range(26):
        x = rng.uniform(W * 0.05, W * 0.95)
        y = rng.uniform(H * 0.66, H * 0.76)
        img = glow(img, (x, y), rng.uniform(10, 26), hx("#ffbf7d")[:3], rng.randint(50, 130), 2.3)

    # river
    water = vgrad(
        [
            (0.0, hx("#1a1230")[:3]),
            (0.3, hx("#140f27")[:3]),
            (1.0, hx("#05040d")[:3]),
        ]
    )
    mask = Image.new("L", (W, H), 0)
    wm = ImageDraw.Draw(mask)
    wm.rectangle([0, H * 0.74, W, H], fill=255)
    img = Image.composite(water, img, mask)
    img = glow(img, (W * 0.5, H * 0.76), W * 0.5, hx("#7d5b8f")[:3], 45, 2.5)
    # fireworks reflections
    refl = new_layer()
    rd = ImageDraw.Draw(refl)
    for cx, color, w, top in [(0.26, "#ffa3c9", 0.18, 0.24), (0.62, "#ffd28f", 0.22, 0.17), (0.82, "#8fe8df", 0.14, 0.32)]:
        for _ in range(14):
            y = rng.uniform(H * 0.75, H * 0.98)
            ln = rng.uniform(20, 120)
            rd.line(
                [(W * cx - ln, y), (W * cx + ln, y)],
                fill=hx(color, rng.randint(8, 42)),
                width=rng.choice([2, 3]),
            )
        rd.rectangle([W * cx - W * w * 0.2, H * 0.75, W * cx + W * w * 0.2, H * 0.95], fill=hx(color, 18))
    img = overlay(img, refl.filter(ImageFilter.GaussianBlur(5)))
    # floating lanterns on the river
    for _ in range(20):
        x = rng.uniform(W * 0.03, W * 0.97)
        y = rng.uniform(H * 0.76, H * 0.96)
        s = lerp(5, 22, (y - H * 0.76) / (H * 0.2))
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.rectangle([x - s * 0.5, y - s * 0.25, x + s * 0.5, y + s * 0.25], fill=hx("#ffd49b", 230))
        img = overlay(img, layer)
        img = glow(img, (x, y), s * 3.2, hx("#ffc07a")[:3], 80, 2.4)
        refl = new_layer()
        rd = ImageDraw.Draw(refl)
        rd.ellipse([x - s, y + s * 0.5, x + s, y + s * 1.4], fill=hx("#ffc07a", 45))
        img = overlay(img, refl.filter(ImageFilter.GaussianBlur(5)))
    # foreground sparkles
    for _ in range(40):
        x, y = rng.uniform(0, W), rng.uniform(H * 0.35, H)
        img = glow(img, (x, y), rng.uniform(6, 16), hx("#ffe6b8")[:3], rng.randint(20, 60), 2.2)
    return finish(img, bloom=0.28, grain=0.05, vignette=0.55, saturation=1.08)


def scene_observatory(rng):
    img = vgrad(
        [
            (0.0, hx("#030616")[:3]),
            (0.32, hx("#081027")[:3]),
            (0.58, hx("#16213d")[:3]),
            (0.72, hx("#283351")[:3]),
            (0.82, hx("#4a526c")[:3]),
            (1.0, hx("#0b1020")[:3]),
        ]
    )
    img = stars(img, rng, 900, 0.68, (236, 243, 255), 240)
    # milky way
    band = new_layer()
    bd = ImageDraw.Draw(band)
    bd.polygon(
        [(W * 0.05, 0), (W * 0.22, 0), (W * 0.93, H * 0.53), (W * 0.85, H * 0.57), (W * 0.04, H * 0.16)],
        fill=hx("#aebcdf", 7),
    )
    band = band.filter(ImageFilter.GaussianBlur(90))
    img = screen(img, band.convert("RGB"))
    dense = new_layer()
    dd = ImageDraw.Draw(dense)
    for _ in range(600):
        t = rng.random()
        x = W * (0.1 + t * 0.85)
        y = rng.gauss(H * (0.02 + t * 0.48), H * 0.03)
        if 0 < y < H * 0.62:
            r = rng.choice([1, 1, 2])
            dd.ellipse([x - r, y - r, x + r, y + r], fill=hx("#eef2ff", rng.randint(40, 150)))
    img = overlay(img, dense)
    # shooting stars
    for _ in range(3):
        x0, y0 = rng.uniform(0, W * 0.7), rng.uniform(0, H * 0.25)
        ln = rng.uniform(100, 260)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.line([(x0, y0), (x0 + ln, y0 + ln * 0.28)], fill=hx("#ffffff", 150), width=2)
        layer = layer.filter(ImageFilter.GaussianBlur(1.5))
        img = screen(img, layer.convert("RGB"))

    img = ridge(img, rng, H * 0.8, H * 0.16, hx("#141a2b")[:3], 0.4, 0, 2)
    # hill
    hill = new_layer()
    hd = ImageDraw.Draw(hill)
    hd.ellipse([-W * 0.35, H * 0.8, W * 0.85, H * 1.7], fill=hx("#0b101d"))
    img = overlay(img, hill.filter(ImageFilter.GaussianBlur(2)))
    # observatory dome
    obs = new_layer()
    od = ImageDraw.Draw(obs)
    cx, base = W * 0.44, H * 0.845
    dw = W * 0.26
    od.rectangle([cx - dw * 0.5, base - dw * 0.12, cx + dw * 0.5, base], fill=hx("#0e1525"))
    od.pieslice([cx - dw * 0.5, base - dw * 0.38, cx + dw * 0.5, base + dw * 0.12], 180, 360, fill=hx("#141c31"))
    od.rectangle([cx - dw * 0.075, base - dw * 0.36, cx + dw * 0.075, base - dw * 0.1], fill=hx("#070b14"))
    od.arc([cx - dw * 0.5, base - dw * 0.38, cx + dw * 0.5, base + dw * 0.12], 186, 354, fill=hx("#a9b8d8", 150), width=3)
    od.line([(cx - dw * 0.46, base - dw * 0.1), (cx + dw * 0.46, base - dw * 0.1)], fill=hx("#9aa7c4", 80), width=2)
    od.rectangle([cx + dw * 0.3, base - dw * 0.04, cx + dw * 0.39, base + dw * 0.07], fill=hx("#ffcc8a"))
    # telescope silhouette outside
    tx = cx + dw * 0.74
    od.line([(tx - 22, base), (tx + 22, base)], fill=hx("#080c15"), width=4)
    od.line([(tx + 2, base), (tx + 10, base - 58)], fill=hx("#080c15"), width=6)
    od.line([(tx + 4, base - 56), (tx + 58, base - 84)], fill=hx("#080c15"), width=12)
    img = overlay(img, obs)
    img = glow(img, (cx + dw * 0.45, base - dw * 0.02), dw * 0.34, hx("#ffc884")[:3], 100, 2.3)
    img = glow(img, (cx, base - dw * 0.2), dw * 0.5, hx("#9fb6e0")[:3], 20, 2.4)
    # pines
    pine_layer = new_layer()
    pd = ImageDraw.Draw(pine_layer)
    for _ in range(8):
        x = rng.uniform(0, W * 0.2) if rng.random() < 0.5 else rng.uniform(W * 0.72, W)
        y = rng.uniform(H * 0.84, H * 0.94)
        h = rng.uniform(H * 0.1, H * 0.22)
        pd.polygon([(x, y - h), (x - h * 0.22, y), (x + h * 0.22, y)], fill=hx("#070b13"))
        for i in range(3):
            yy = y - h * (0.2 + i * 0.22)
            ww = h * (0.22 - i * 0.04)
            pd.polygon([(x, yy - h * 0.3), (x - ww, yy), (x + ww, yy)], fill=hx("#070b13"))
    img = overlay(img, pine_layer)
    img = haze(img, 0.75, 0.85, hx("#8fa0c4")[:3], 0, 50)
    img = glow(img, (W * 0.6, H * 0.86), W * 0.05, hx("#ffb46b")[:3], 40, 2.5)
    return finish(img, bloom=0.24, grain=0.05, vignette=0.6, saturation=1.0)


def scene_train(rng):
    img = vgrad(
        [
            (0.0, hx("#232142")[:3]),
            (0.25, hx("#4b3d64")[:3]),
            (0.45, hx("#91627a")[:3]),
            (0.6, hx("#d58f87")[:3]),
            (0.7, hx("#f8c79a")[:3]),
            (0.8, hx("#e0a486")[:3]),
            (1.0, hx("#241b2b")[:3]),
        ]
    )
    sun = (W * 0.36, H * 0.61)
    img = glow(img, sun, W * 0.26, hx("#ffe5b8")[:3], 110, 2.2)
    img = glow(img, sun, W * 0.05, hx("#fff5da")[:3], 170, 2.4)
    img = soft_blobs(
        img,
        [
            (W * 0.25, H * 0.3, W * 0.3, H * 0.035, hx("#e8b6b8"), 60),
            (W * 0.7, H * 0.24, W * 0.28, H * 0.03, hx("#c0a1b7"), 50),
            (W * 0.55, H * 0.46, W * 0.35, H * 0.035, hx("#ffd6b6"), 60),
        ],
        40,
    )
    img = ridge(img, rng, H * 0.66, H * 0.09, hx("#5d4a68")[:3], 0.3, 0, 4)
    # rails converge to a vanishing point
    vp = (W * 0.47, H * 0.64)
    rail = new_layer()
    rd = ImageDraw.Draw(rail)
    rd.polygon([(0, H), (0, H * 0.86), vp, (W * 0.32, H)], fill=hx("#2a2030"))
    for off in (-0.5, 0.5):
        rd.line(
            [(vp[0] + off * 40, vp[1]), (W * 0.02 + off * W * 0.55, H + 30)],
            fill=hx("#0f0b14"),
            width=9,
        )
        rd.line(
            [(vp[0] + off * 40, vp[1]), (W * 0.02 + off * W * 0.55, H + 30)],
            fill=hx("#e7b795", 90),
            width=2,
        )
    for i in range(12):
        t = i / 11
        y = lerp(H * 0.66, H * 1.02, t ** 1.6)
        x0 = lerp(vp[0], W * 0.02, t ** 1.6)
        w = lerp(18, W * 0.55, t ** 1.6)
        rd.line([(x0 - w * 0.5, y), (x0 + w * 0.5, y)], fill=hx("#1b1522"), width=max(3, int(2 + t * 8)))
    img = overlay(img, rail)
    # a distant train waiting at the crossing
    train_layer = new_layer()
    td = ImageDraw.Draw(train_layer)
    tx0, ty0, tw0, th0 = W * 0.13, H * 0.6, W * 0.28, H * 0.075
    td.rounded_rectangle([tx0, ty0 - th0, tx0 + tw0, ty0], radius=10, fill=hx("#1a1524", 250))
    td.rectangle([tx0 + tw0 * 0.02, ty0 - th0 * 0.66, tx0 + tw0 * 0.98, ty0 - th0 * 0.42], fill=hx("#2b2233"))
    for i in range(9):
        wx = tx0 + tw0 * (0.06 + i * 0.1)
        td.rectangle([wx, ty0 - th0 * 0.6, wx + tw0 * 0.055, ty0 - th0 * 0.46], fill=hx("#ffd9a3", 220))
    td.rectangle([tx0 - W * 0.012, ty0 - th0 * 0.55, tx0 + W * 0.005, ty0 - th0 * 0.4], fill=hx("#fff3cf"))
    td.line([(tx0, ty0), (tx0 + tw0, ty0)], fill=hx("#241b2c"), width=6)
    img = overlay(img, train_layer)
    img = glow(img, (tx0 - W * 0.01, ty0 - th0 * 0.48), W * 0.05, hx("#fff0c8")[:3], 130, 2.1)
    img = glow(img, (tx0 + tw0 * 0.5, ty0 - th0 * 0.35), W * 0.1, hx("#ffd7a0")[:3], 35, 2.4)
    # platform edge on the right
    platform = new_layer()
    pd = ImageDraw.Draw(platform)
    pd.polygon([(W * 0.62, H * 0.7), (W, H * 0.66), (W, H), (W * 0.44, H)], fill=hx("#2b2231"))
    pd.line([(W * 0.62, H * 0.7), (W * 0.44, H)], fill=hx("#f2c79c", 150), width=6)
    pd.line([(W * 0.65, H * 0.73), (W * 0.5, H)], fill=hx("#c9a17e", 80), width=3)
    pd.line([(W * 0.68, H * 0.755), (W * 0.55, H)], fill=hx("#d8b090", 110), width=4)
    # platform shelter roof
    pd.polygon([(W * 0.66, H * 0.3), (W, H * 0.26), (W, H * 0.33), (W * 0.62, H * 0.37)], fill=hx("#191220"))
    for x in (0.72, 0.86, 0.98):
        pd.rectangle([W * x - 6, H * 0.34, W * x + 6, H * 0.8], fill=hx("#15101c"))
    # bench
    pd.rectangle([W * 0.78, H * 0.72, W * 0.93, H * 0.75], fill=hx("#130e19"))
    pd.rectangle([W * 0.78, H * 0.75, W * 0.93, H * 0.78], fill=hx("#1b1422"))
    pd.line([(W * 0.79, H * 0.78), (W * 0.79, H * 0.83)], fill=hx("#130e19"), width=5)
    pd.line([(W * 0.92, H * 0.78), (W * 0.92, H * 0.83)], fill=hx("#130e19"), width=5)
    img = overlay(img, platform)
    # warm pools of lamp light on the platform
    img = soft_blobs(
        img,
        [
            (W * 0.79, H * 0.82, W * 0.13, H * 0.045, hx("#ffcb8e"), 70),
            (W * 0.88, H * 0.9, W * 0.14, H * 0.04, hx("#ffc785"), 50),
        ],
        30,
    )
    # hanging lamp
    img = glow(img, (W * 0.79, H * 0.39), W * 0.07, hx("#ffcf94")[:3], 120, 2.2)
    lamp = new_layer()
    ld = ImageDraw.Draw(lamp)
    ld.line([(W * 0.79, H * 0.33), (W * 0.79, H * 0.38)], fill=hx("#15101c"), width=3)
    ld.polygon([(W * 0.775, H * 0.4), (W * 0.805, H * 0.4), (W * 0.798, H * 0.385), (W * 0.782, H * 0.385)], fill=hx("#ffdfad"))
    img = overlay(img, lamp)
    # station sign
    sign = new_layer()
    sd = ImageDraw.Draw(sign)
    sx, sy, sw, sh = W * 0.815, H * 0.46, W * 0.14, H * 0.06
    sd.rounded_rectangle([sx - sw / 2, sy - sh / 2, sx + sw / 2, sy + sh / 2], radius=8, fill=hx("#f1e6da", 235))
    try:
        font = ImageFont.truetype(FONT_JP, 34)
        sd.text((sx, sy - 4), "星見ヶ丘", font=font, fill=hx("#2e2438"), anchor="mm")
    except OSError:
        pass
    img = overlay(img, sign)
    img = glow(img, (sx, sy), sw * 0.7, hx("#ffe6c4")[:3], 35, 2.4)
    # signal light
    sx2, sy2 = W * 0.29, H * 0.5
    sig = new_layer()
    sgd = ImageDraw.Draw(sig)
    sgd.line([(sx2, sy2), (sx2, H * 0.82)], fill=hx("#17111f"), width=6)
    sgd.rectangle([sx2 - 16, sy2 - 40, sx2 + 16, sy2 + 10], fill=hx("#17111f"))
    img = overlay(img, sig)
    img = glow(img, (sx2, sy2 - 24), W * 0.02, hx("#ff6b6b")[:3], 190, 2.0)
    # petals
    img = petals(img, rng, 80, (0, H * 0.1, W, H), 2, (4, 12))
    # distant town lights
    for _ in range(30):
        x, y = rng.uniform(0, W * 0.55), rng.uniform(H * 0.64, H * 0.68)
        img = glow(img, (x, y), rng.uniform(5, 12), hx("#ffd29c")[:3], 50, 2.2)
    return finish(img, bloom=0.22, grain=0.05, vignette=0.5, saturation=1.04)


def scene_underwater(rng):
    img = vgrad(
        [
            (0.0, hx("#0d6f76")[:3]),
            (0.18, hx("#0b5f6b")[:3]),
            (0.45, hx("#083f4f")[:3]),
            (0.72, hx("#052b39")[:3]),
            (1.0, hx("#02141d")[:3]),
        ]
    )
    # surface glow and shafts
    img = glow(img, (W * 0.5, 0), W * 0.7, hx("#bff5ea")[:3], 130, 1.6)
    for i in range(9):
        x = rng.uniform(0, W)
        w = rng.uniform(40, 160)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.polygon(
            [(x - w * 0.2, 0), (x + w * 0.2, 0), (x + w * 1.6, H * 0.85), (x + w * 0.6, H * 0.85)],
            fill=hx("#d6fff2", rng.randint(8, 22)),
        )
        img = screen(img, layer.filter(ImageFilter.GaussianBlur(38)).convert("RGB"))
    # caustic shimmer near the top
    caustic = new_layer()
    cd = ImageDraw.Draw(caustic)
    for _ in range(120):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H * 0.4)
        w = rng.uniform(20, 120)
        cd.arc([x - w, y - w * 0.15, x + w, y + w * 0.15], rng.uniform(0, 180), rng.uniform(200, 360), fill=hx("#9ff0e4", rng.randint(10, 30)), width=2)
    img = overlay(img, caustic.filter(ImageFilter.GaussianBlur(3)))

    # ancient seabed
    img = ridge(img, rng, H * 0.9, H * 0.12, hx("#0b2b2c")[:3], 0.5, 0, 4)
    img = haze(img, 0.5, 0.9, hx("#0f6a6b")[:3], 0, 40)
    # ruined torii
    torii = new_layer()
    draw_torii(torii, W * 0.62, H * 0.88, H * 0.3, "#0a2426", 255, "#9fe6d4")
    img = overlay(img, torii)
    # broken pillars
    pillars = new_layer()
    pd = ImageDraw.Draw(pillars)
    for _ in range(7):
        x = rng.uniform(W * 0.05, W * 0.95)
        y = rng.uniform(H * 0.78, H * 0.94)
        h = rng.uniform(H * 0.08, H * 0.3)
        w = rng.uniform(30, 90)
        pd.polygon([(x - w / 2, y), (x + w / 2, y), (x + w * 0.35, y - h), (x - w * 0.4, y - h * rng.uniform(0.6, 1))], fill=hx("#0a2528"))
        pd.line([(x - w * 0.4, y - h * 0.9), (x + w * 0.3, y - h * 0.95)], fill=hx("#4c8f7d", 100), width=3)
    img = overlay(img, pillars)
    # seaweed
    weed = new_layer()
    wd = ImageDraw.Draw(weed)
    for _ in range(40):
        x = rng.uniform(0, W)
        y = rng.uniform(H * 0.82, H)
        h = rng.uniform(40, 170)
        wd.line(
            [(x, y), (x + rng.uniform(-25, 25), y - h * 0.5), (x + rng.uniform(-35, 35), y - h)],
            fill=hx(rng.choice(["#1f5a45", "#2c6d50", "#174834"]), rng.randint(90, 190)),
            width=rng.randint(4, 10),
            joint="curve",
        )
    img = overlay(img, weed.filter(ImageFilter.GaussianBlur(1.5)))
    # fish
    fish = new_layer()
    fd = ImageDraw.Draw(fish)
    for _ in range(26):
        x = rng.uniform(0, W)
        y = rng.uniform(H * 0.15, H * 0.7)
        s = rng.uniform(8, 26)
        fd.ellipse([x - s, y - s * 0.3, x + s, y + s * 0.3], fill=hx("#0a3440", 210))
        fd.polygon([(x - s, y), (x - s * 1.7, y - s * 0.35), (x - s * 1.7, y + s * 0.35)], fill=hx("#0a3440", 210))
    img = overlay(img, fish.filter(ImageFilter.GaussianBlur(1.2)))
    # particles / bubbles
    for _ in range(70):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H)
        r = rng.uniform(1, 4)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.ellipse([x - r, y - r, x + r, y + r], fill=hx("#d5fff4", rng.randint(20, 80)))
        img = overlay(img, layer)
    for _ in range(16):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H * 0.8)
        r = rng.uniform(4, 10)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.ellipse([x - r, y - r, x + r, y + r], outline=hx("#d9fff5", 120), width=2)
        img = overlay(img, layer)
    img = sparkle_glow(img, (W * 0.34, H * 0.22), "#d8fff2", 26, 70)
    return finish(img, bloom=0.25, grain=0.05, vignette=0.55, saturation=1.05)


def scene_cafe(rng):
    img = vgrad(
        [
            (0.0, hx("#241820")[:3]),
            (0.4, hx("#3a2530")[:3]),
            (0.7, hx("#4a2e35")[:3]),
            (1.0, hx("#1a1118")[:3]),
        ]
    )
    # window
    wx0, wy0, wx1, wy1 = W * 0.04, H * 0.08, W * 0.6, H * 0.76
    window = vgrad(
        [
            (0.0, hx("#0b1830")[:3]),
            (0.4, hx("#132544")[:3]),
            (0.7, hx("#2d3150")[:3]),
            (1.0, hx("#161327")[:3]),
        ]
    )
    mask = Image.new("L", (W, H), 0)
    wm = ImageDraw.Draw(mask)
    wm.rectangle([wx0, wy0, wx1, wy1], fill=255)
    img = Image.composite(window, img, mask)
    # rain-soaked city outside
    city = new_layer()
    cd = ImageDraw.Draw(city)
    for _ in range(46):
        bx = rng.uniform(wx0, wx1)
        bw = rng.uniform(0.02, 0.07) * W
        bh = rng.uniform(0.04, 0.16) * H
        by = wy1
        cd.rectangle([bx, by - bh, bx + bw, by], fill=hx("#0a1222", 220))
        for _ in range(rng.randint(1, 4)):
            wx = bx + rng.uniform(3, max(4, bw - 8))
            wy = by - bh + rng.uniform(3, max(4, bh - 10))
            cd.rectangle([wx, wy, wx + 5, wy + 6], fill=hx(rng.choice(["#ffcf95", "#9de4ec", "#f6a9c8"]), rng.randint(70, 190)))
    img = overlay(img, city.filter(ImageFilter.GaussianBlur(3)))
    street = new_layer()
    sdw = ImageDraw.Draw(street)
    sdw.rectangle([wx0, wy1 - H * 0.05, wx1, wy1], fill=hx("#141a2e", 200))
    for _ in range(26):
        x = rng.uniform(wx0, wx1)
        y = rng.uniform(wy1 - H * 0.05, wy1)
        sdw.line([(x - 20, y), (x + 20, y)], fill=hx(rng.choice(["#ffbf7d", "#ff8fb8", "#8fe0e8"]), rng.randint(20, 70)), width=3)
    img = overlay(img, street.filter(ImageFilter.GaussianBlur(6)))
    # city bokeh outside
    bokeh = new_layer()
    bd = ImageDraw.Draw(bokeh)
    for _ in range(80):
        x = rng.uniform(wx0, wx1)
        y = rng.uniform(wy0, wy1)
        r = rng.uniform(10, 52)
        color = rng.choice(["#ffb8d2", "#ffd79a", "#90e0ec", "#c4a6ff"])
        bd.ellipse([x - r, y - r, x + r, y + r], fill=hx(color, rng.randint(26, 85)))
    img = overlay(img, bokeh.filter(ImageFilter.GaussianBlur(16)))
    # warm lamp reflection in the glass
    img = glow(img, (W * 0.25, H * 0.33), W * 0.16, hx("#ffbd80")[:3], 22, 2.4)
    # rain on the glass
    rain = new_layer()
    rd = ImageDraw.Draw(rain)
    for _ in range(170):
        x = rng.uniform(wx0, wx1)
        y = rng.uniform(wy0, wy1)
        ln = rng.uniform(10, 50)
        rd.line([(x, y), (x + rng.uniform(-4, 4), y + ln)], fill=hx("#cfd9ff", rng.randint(15, 50)), width=rng.choice([1, 2]))
        if rng.random() < 0.2:
            rd.ellipse([x - 3, y - 3, x + 3, y + 3], fill=hx("#e6edff", 60))
    img = overlay(img, rain)
    # window frame
    frame = new_layer()
    fd = ImageDraw.Draw(frame)
    fd.rectangle([wx0, wy0, wx1, wy1], outline=hx("#1a1118"), width=18)
    fd.line([(wx0 + (wx1 - wx0) * 0.5, wy0), (wx0 + (wx1 - wx0) * 0.5, wy1)], fill=hx("#1a1118"), width=12)
    fd.line([(wx0, wy0 + (wy1 - wy0) * 0.45), (wx1, wy0 + (wy1 - wy0) * 0.45)], fill=hx("#1a1118"), width=12)
    img = overlay(img, frame)
    # wood panelled back wall
    wall = new_layer()
    wd = ImageDraw.Draw(wall)
    for i in range(9):
        x = W * (0.62 + i * 0.042)
        wd.line([(x, 0), (x, H * 0.78)], fill=hx("#33202a", 90), width=2)
    wd.line([(W * 0.61, H * 0.52), (W, H * 0.52)], fill=hx("#24161e", 150), width=5)
    # framed prints
    for fx, fy, fw, fh in [(0.69, 0.08, 0.075, 0.12), (0.9, 0.13, 0.06, 0.09)]:
        wd.rectangle([W * fx, H * fy, W * (fx + fw), H * (fy + fh)], fill=hx("#3a2630"))
        wd.rectangle([W * (fx + 0.006), H * (fy + 0.01), W * (fx + fw - 0.006), H * (fy + fh - 0.01)], fill=hx("#75657a"))
    img = overlay(img, wall)
    # warm interior wall glow
    img = glow(img, (W * 0.8, H * 0.3), W * 0.3, hx("#ffb46b")[:3], 70, 2.2)
    # pendant lamp
    img = glow(img, (W * 0.79, H * 0.26), W * 0.08, hx("#ffcf92")[:3], 150, 2.0)
    lamp = new_layer()
    ld = ImageDraw.Draw(lamp)
    ld.line([(W * 0.79, 0), (W * 0.79, H * 0.18)], fill=hx("#120c12"), width=4)
    ld.polygon([(W * 0.735, H * 0.24), (W * 0.845, H * 0.24), (W * 0.815, H * 0.17), (W * 0.765, H * 0.17)], fill=hx("#24161a"))
    ld.ellipse([W * 0.75, H * 0.225, W * 0.83, H * 0.255], fill=hx("#ffe0ac"))
    img = overlay(img, lamp)
    # shelf with cups
    shelf = new_layer()
    sd = ImageDraw.Draw(shelf)
    sd.rectangle([W * 0.66, H * 0.42, W * 0.98, H * 0.435], fill=hx("#241620"))
    for i in range(5):
        x = W * (0.7 + i * 0.055)
        sd.rectangle([x - 12, H * 0.39, x + 12, H * 0.42], fill=hx("#3a2630"))
        sd.ellipse([x - 12, H * 0.383, x + 12, H * 0.397], fill=hx("#4a303a"))
    img = overlay(img, shelf)
    # hanging plants
    plant = new_layer()
    pd = ImageDraw.Draw(plant)
    for base_x in (0.66, 0.93):
        pd.line([(W * base_x, H * 0.02), (W * base_x, H * 0.1)], fill=hx("#171018"), width=3)
        for _ in range(8):
            ang = rng.uniform(1.2, 2.0) if base_x < 0.8 else rng.uniform(2.0, 2.9)
            ln = rng.uniform(30, 100)
            ex, ey = W * base_x + math.cos(ang) * ln, H * 0.09 + math.sin(ang) * ln * -0.4 + ln * 0.4
            pd.line([(W * base_x, H * 0.09), (ex, ey)], fill=hx("#1b241c"), width=2)
            pd.ellipse([ex - 12, ey - 6, ex + 12, ey + 6], fill=hx("#223026"))
    img = overlay(img, plant)
    # a little framed menu and a wall vase
    deco = new_layer()
    ddw = ImageDraw.Draw(deco)
    ddw.rectangle([W * 0.63, H * 0.22, W * 0.675, H * 0.34], fill=hx("#2e1d26"))
    ddw.rectangle([W * 0.636, H * 0.228, W * 0.669, H * 0.332], fill=hx("#c9b3a8"))
    ddw.line([(W * 0.642, H * 0.25), (W * 0.662, H * 0.25)], fill=hx("#5a4038"), width=2)
    ddw.line([(W * 0.642, H * 0.27), (W * 0.662, H * 0.27)], fill=hx("#5a4038"), width=2)
    ddw.line([(W * 0.642, H * 0.29), (W * 0.662, H * 0.29)], fill=hx("#5a4038"), width=2)
    img = overlay(img, deco)
    # table, cup, book
    table = new_layer()
    td = ImageDraw.Draw(table)
    td.polygon([(W * 0.28, H), (W * 0.95, H), (W * 0.9, H * 0.8), (W * 0.36, H * 0.8)], fill=hx("#2a1a20"))
    td.line([(W * 0.36, H * 0.8), (W * 0.9, H * 0.8)], fill=hx("#c58f70", 80), width=3)
    # saucer + cup
    cx, cy = W * 0.63, H * 0.845
    td.ellipse([cx - 90, cy - 18, cx + 90, cy + 18], fill=hx("#3a242a"))
    td.ellipse([cx - 56, cy - 38, cx + 56, cy + 8], fill=hx("#f0e2d2"))
    td.arc([cx + 50, cy - 36, cx + 86, cy - 2], 270, 90, fill=hx("#e8d8c8"), width=7)
    td.ellipse([cx - 48, cy - 33, cx + 48, cy - 4], fill=hx("#5a3428"))
    # book
    td.polygon([(W * 0.78, H * 0.82), (W * 0.92, H * 0.8), (W * 0.93, H * 0.84), (W * 0.79, H * 0.86)], fill=hx("#3c2a32"))
    td.line([(W * 0.79, H * 0.82), (W * 0.92, H * 0.805)], fill=hx("#ffd8a8", 90), width=2)
    img = overlay(img, table)
    # steam
    steam = new_layer()
    sd2 = ImageDraw.Draw(steam)
    for i in range(3):
        x = cx - 10 + i * 12
        sd2.line(
            [(x, cy - 40), (x + 10, cy - 90), (x - 4, cy - 140)],
            fill=hx("#ffe8cf", 26),
            width=8,
            joint="curve",
        )
    img = overlay(img, steam.filter(ImageFilter.GaussianBlur(8)))
    # cat on a chair silhouette
    cat = new_layer()
    cd = ImageDraw.Draw(cat)
    catx, caty = W * 0.82, H * 0.78
    cd.ellipse([catx - 60, caty - 26, catx + 58, caty + 22], fill=hx("#120c12"))
    cd.ellipse([catx - 40, caty - 66, catx + 6, caty - 16], fill=hx("#120c12"))
    cd.polygon([(catx - 38, caty - 58), (catx - 30, caty - 86), (catx - 12, caty - 62)], fill=hx("#120c12"))
    cd.polygon([(catx - 4, caty - 62), (catx + 8, caty - 84), (catx + 16, caty - 54)], fill=hx("#120c12"))
    cd.line([(catx + 52, caty - 2), (catx + 92, caty + 16), (catx + 82, caty + 38)], fill=hx("#120c12"), width=10, joint="curve")
    img = overlay(img, cat)
    # warm vignette / lamp light spill
    img = glow(img, (W * 0.66, H * 0.62), W * 0.22, hx("#ffb46b")[:3], 35, 2.3)
    img = glow(img, (W * 0.63, H * 0.84), W * 0.1, hx("#ffcf9a")[:3], 40, 2.2)
    # chair silhouette in the near foreground
    chair = new_layer()
    chd = ImageDraw.Draw(chair)
    chd.rectangle([W * 0.02, H * 0.9, W * 0.2, H * 0.95], fill=hx("#120c12"))
    chd.rectangle([W * 0.02, H * 0.62, W * 0.06, H * 0.95], fill=hx("#120c12"))
    chd.rectangle([W * 0.02, H * 0.62, W * 0.2, H * 0.67], fill=hx("#120c12"))
    chd.line([(W * 0.18, H * 0.95), (W * 0.19, H)], fill=hx("#120c12"), width=8)
    chd.line([(W * 0.04, H * 0.95), (W * 0.03, H)], fill=hx("#120c12"), width=8)
    img = overlay(img, chair.filter(ImageFilter.GaussianBlur(4)))
    return finish(img, bloom=0.18, grain=0.06, vignette=0.62, saturation=1.05)


def scene_torii_sunrise(rng):
    img = vgrad(
        [
            (0.0, hx("#3d3b78")[:3]),
            (0.24, hx("#8c6a95")[:3]),
            (0.46, hx("#e29a9a")[:3]),
            (0.58, hx("#ffc9a8")[:3]),
            (0.68, hx("#ffe3bd")[:3]),
            (0.78, hx("#f3c9a9")[:3]),
            (1.0, hx("#5b4a5f")[:3]),
        ]
    )
    sun = (W * 0.52, H * 0.56)
    img = glow(img, sun, W * 0.34, hx("#ffe1b0")[:3], 120, 2.2)
    img = glow(img, sun, W * 0.08, hx("#fff7e0")[:3], 210, 2.2)
    sun_layer = new_layer()
    sd = ImageDraw.Draw(sun_layer)
    sd.ellipse([sun[0] - 95, sun[1] - 95, sun[0] + 95, sun[1] + 95], fill=hx("#fff3d6"))
    img = overlay(img, sun_layer)
    img = soft_blobs(
        img,
        [
            (W * 0.18, H * 0.3, W * 0.24, H * 0.03, hx("#ffd7c2"), 45),
            (W * 0.82, H * 0.25, W * 0.24, H * 0.025, hx("#f0bfc0"), 40),
            (W * 0.5, H * 0.42, W * 0.3, H * 0.02, hx("#ffe1c4"), 40),
        ],
        30,
    )
    img = ridge(img, rng, H * 0.68, H * 0.16, hx("#7c6274")[:3], 0.4, 0, 5)
    img = haze(img, 0.56, 0.75, hx("#ffd9bd")[:3], 0, 90)
    img = ridge(img, rng, H * 0.74, H * 0.07, hx("#453c52")[:3], 0.5, 0, 2)
    # water
    water = vgrad(
        [
            (0.0, hx("#c99a94")[:3]),
            (0.3, hx("#8d6f7e")[:3]),
            (0.7, hx("#4a3e52")[:3]),
            (1.0, hx("#231e2e")[:3]),
        ]
    )
    mask = Image.new("L", (W, H), 0)
    wm = ImageDraw.Draw(mask)
    wm.rectangle([0, H * 0.75, W, H], fill=255)
    img = Image.composite(water, img, mask)
    # sun reflection
    for i in range(40):
        y = rng.uniform(H * 0.755, H * 0.98)
        depth = (y - H * 0.755) / (H * 0.225)
        x = sun[0] + rng.uniform(-1, 1) * (30 + depth * 120)
        ln = rng.uniform(10, 80) * (1 - depth * 0.4)
        layer = new_layer()
        d = ImageDraw.Draw(layer)
        d.line([(x - ln, y), (x + ln, y)], fill=hx("#ffdfb4", rng.randint(20, 100)), width=rng.choice([2, 3, 4]))
        img = overlay(img, layer.filter(ImageFilter.GaussianBlur(1.5)))
    # mist banks on water
    img = soft_blobs(
        img,
        [
            (W * 0.3, H * 0.77, W * 0.35, H * 0.03, hx("#ffe4cf"), 55),
            (W * 0.75, H * 0.8, W * 0.32, H * 0.028, hx("#f7d5c7"), 50),
            (W * 0.52, H * 0.83, W * 0.4, H * 0.025, hx("#ffe9d8"), 40),
        ],
        26,
    )
    # torii on a small island
    torii = new_layer()
    draw_torii(torii, W * 0.43, H * 0.795, H * 0.22, "#2a1d2c", 255, "#ffd7ae")
    rock = new_layer()
    rd = ImageDraw.Draw(rock)
    rd.ellipse([W * 0.32, H * 0.78, W * 0.55, H * 0.82], fill=hx("#2a1d2c"))
    img = overlay(img, rock.filter(ImageFilter.GaussianBlur(1)))
    img = overlay(img, torii)
    # torii reflection
    refl = new_layer()
    rfd = ImageDraw.Draw(refl)
    rfd.polygon([(W * 0.34, H * 0.82), (W * 0.52, H * 0.82), (W * 0.55, H * 1.02), (W * 0.31, H * 1.02)], fill=hx("#2a1d2c", 70))
    img = overlay(img, refl.filter(ImageFilter.GaussianBlur(12)))
    img = glow(img, (W * 0.43, H * 0.72), W * 0.2, hx("#ffd0a0")[:3], 45, 2.4)
    # birds
    bird = new_layer()
    bd = ImageDraw.Draw(bird)
    for _ in range(8):
        x, y = rng.uniform(W * 0.55, W * 0.9), rng.uniform(H * 0.15, H * 0.35)
        s = rng.uniform(8, 16)
        bd.arc([x - s, y - s * 0.5, x, y + s * 0.5], 200, 340, fill=hx("#5b3c48", 200), width=3)
        bd.arc([x, y - s * 0.5, x + s, y + s * 0.5], 200, 340, fill=hx("#5b3c48", 200), width=3)
    img = overlay(img, bird)
    img = petals(img, rng, 40, (0, H * 0.2, W, H * 0.9), 3, (4, 12))
    return finish(img, bloom=0.22, grain=0.045, vignette=0.45, saturation=1.03)


SCENES = {
    "sakura-shrine": scene_sakura_shrine,
    "moon-garden": scene_moon_garden,
    "neon-alley": scene_neon,
    "sky-islands": scene_sky_islands,
    "lighthouse": scene_lighthouse,
    "bamboo": scene_bamboo,
    "rooftop": scene_rooftop,
    "snow-village": scene_snow_village,
    "festival": scene_festival,
    "observatory": scene_observatory,
    "train": scene_train,
    "underwater": scene_underwater,
    "cafe": scene_cafe,
    "torii-sunrise": scene_torii_sunrise,
}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or list(SCENES)
    for name in wanted:
        fn = SCENES.get(name)
        if not fn:
            print(f"unknown scene {name}")
            continue
        rng = random.Random(hash(name) & 0xFFFF)
        img = fn(rng)
        img = img.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)
        path = OUT_DIR / f"{name}.webp"
        img.save(path, "WEBP", quality=86, method=6)
        print(f"wrote {path.relative_to(ROOT)}  ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
