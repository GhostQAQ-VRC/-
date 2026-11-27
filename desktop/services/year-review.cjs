'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const repository = require('../library/repository.cjs');

const MAX_GALLERY_PHOTOS = 36;
const MAX_WORLD_COVERS = 6;
const MAX_EMBEDDED_BYTES = 30 * 1024 * 1024;
const MAX_INPUT_FILE_BYTES = 32 * 1024 * 1024;
// Review exports read arbitrary library files; keep the pixel budget well
// below sharp's global ceiling so a crafted 32 MB file cannot balloon memory.
const MAX_INPUT_PIXELS = 50_000_000;
const THUMB_EDGE = 720;
const THUMB_QUALITY = 72;
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function yearOf(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.getFullYear();
}

function dateLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function shortNote(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 120) return text;
  return `${text.slice(0, 119)}…`;
}

function worldKeyOf(photo) {
  return photo.worldRef || photo.world?.id || photo.worldId || photo.world?.name || '';
}

function worldNameOf(photo) {
  return photo.world?.name || photo.worldId || '未关联世界';
}

/** Spread the gallery across the year instead of showing only January. */
function pickGallery(photos, limit = MAX_GALLERY_PHOTOS) {
  const byMonth = Array.from({ length: 12 }, () => []);
  for (const photo of photos) {
    const date = new Date(photo.capturedAt);
    if (!Number.isNaN(date.getTime())) byMonth[date.getMonth()].push(photo);
  }
  const picked = [];
  const perMonth = Math.max(1, Math.ceil(limit / Math.max(1, byMonth.filter((month) => month.length).length)));
  for (const month of byMonth) {
    if (month.length === 0) continue;
    const target = Math.min(perMonth, month.length);
    const indexes = Array.from(
      new Set(
        Array.from({ length: target }, (_, index) =>
          target === 1 ? 0 : Math.round((index * (month.length - 1)) / (target - 1)),
        ),
      ),
    );
    for (const index of indexes.sort((a, b) => a - b)) {
      if (picked.length >= limit) break;
      const photo = month[index];
      if (photo && !picked.includes(photo)) picked.push(photo);
    }
    if (picked.length >= limit) break;
  }
  return picked.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

function summarize(year, photos) {
  const months = Array.from({ length: 12 }, () => 0);
  const worlds = new Map();
  let favorites = 0;
  let unlinked = 0;
  let notes = 0;
  const tags = new Set();
  for (const photo of photos) {
    const date = new Date(photo.capturedAt);
    if (!Number.isNaN(date.getTime())) months[date.getMonth()] += 1;
    if (photo.favorite) favorites += 1;
    if (photo.note && photo.note.trim()) notes += 1;
    for (const tag of Array.isArray(photo.tags) ? photo.tags : []) {
      if (tag) tags.add(tag);
    }
    const key = worldKeyOf(photo);
    if (!key) {
      unlinked += 1;
      continue;
    }
    const entry = worlds.get(key) || {
      key,
      name: worldNameOf(photo),
      photos: 0,
      coverId: null,
      latestAt: '',
    };
    entry.photos += 1;
    if (!entry.latestAt || Date.parse(photo.capturedAt) > Date.parse(entry.latestAt)) {
      entry.latestAt = photo.capturedAt;
      entry.coverId = photo.id;
    }
    worlds.set(key, entry);
  }
  const topWorlds = Array.from(worlds.values())
    .sort((a, b) => b.photos - a.photos || Date.parse(b.latestAt) - Date.parse(a.latestAt))
    .slice(0, MAX_WORLD_COVERS);
  const busiestIndex = months.indexOf(Math.max(...months));
  return {
    year,
    total: photos.length,
    worlds: worlds.size,
    favorites,
    notes,
    tags: tags.size,
    unlinked,
    months,
    busiestMonth: Math.max(...months) > 0 ? busiestIndex + 1 : 0,
    activeMonths: months.filter((count) => count > 0).length,
    firstAt: photos[0]?.capturedAt || null,
    lastAt: photos[photos.length - 1]?.capturedAt || null,
    topWorlds,
  };
}

class YearReviewService {
  constructor(options = {}) {
    this.getRoot = options.getRoot || (() => null);
    this.getAlbum = options.getAlbum || (async () => null);
    this.getPreviewDir = options.getPreviewDir || (async () => null);
  }

  async photosFor(year) {
    const album = await this.getAlbum(this.getRoot());
    const photos = Array.isArray(album?.photos) ? album.photos : [];
    return {
      album,
      photos: photos
        .filter((photo) => !photo.missing && yearOf(photo.capturedAt) === year)
        .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)),
    };
  }

  async listYears() {
    const album = await this.getAlbum(this.getRoot());
    const photos = Array.isArray(album?.photos) ? album.photos : [];
    return Array.from(
      new Set(photos.filter((photo) => !photo.missing).map((photo) => yearOf(photo.capturedAt))),
    )
      .filter((year) => Number.isFinite(year))
      .sort((a, b) => b - a);
  }

  async resolvePhotoFile(photo, root, previewDir) {
    const candidates = [];
    if (photo.previewPath) {
      const name = path.basename(String(photo.previewPath));
      if (name && name === String(photo.previewPath).replace(/\\/g, '/')) {
        const absolute = path.join(previewDir, name);
        const relative = path.relative(root, absolute);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
          candidates.push(repository.toPosix(relative));
        }
      }
    }
    if (photo.libraryPath) candidates.push(photo.libraryPath);
    for (const relative of candidates) {
      const real = await repository.resolveRealInside(root, relative);
      if (!real) continue;
      const stat = await fsp.stat(real).catch(() => null);
      if (stat && stat.isFile()) return real;
    }
    return null;
  }

  async makeThumbnail(photo, root, previewDir, budget) {
    if (budget.bytes >= MAX_EMBEDDED_BYTES) return null;
    const file = await this.resolvePhotoFile(photo, root, previewDir);
    if (!file) return null;
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INPUT_FILE_BYTES) return null;
      // Read into memory before handing the bytes to sharp: libvips caches
      // file handles on Windows, which would keep preview files locked.
      const input = await fsp.readFile(file);
      const buffer = await sharp(input, {
        limitInputPixels: MAX_INPUT_PIXELS,
        failOn: 'none',
      })
        .rotate()
        .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY })
        .toBuffer();
      if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) return null;
      budget.bytes += buffer.length;
      budget.count += 1;
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async build(year) {
    const safeYear = Math.trunc(Number(year));
    if (!Number.isFinite(safeYear) || safeYear < 1970 || safeYear > 2100) {
      return { ok: false, error: '年份无效。' };
    }
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const { album, photos } = await this.photosFor(safeYear);
    if (photos.length === 0) return { ok: false, error: `${safeYear} 年还没有照片。` };

    const previewDir = await this.getPreviewDir(root);
    if (!previewDir) return { ok: false, error: '缩略图缓存不可用。' };

    const summary = summarize(safeYear, photos);
    const gallery = pickGallery(photos);
    const budget = { bytes: 0, count: 0 };
    const images = new Map();
    for (const photo of gallery) {
      const dataUrl = await this.makeThumbnail(photo, root, previewDir, budget);
      if (dataUrl) images.set(photo.id, dataUrl);
    }
    // Some worlds have no photo in the spread-out gallery; borrow their latest
    // photo so every highlighted world still gets a cover.
    for (const world of summary.topWorlds) {
      if (world.coverId && images.has(world.coverId)) continue;
      const photo = photos.find((item) => item.id === world.coverId);
      if (!photo) continue;
      const dataUrl = await this.makeThumbnail(photo, root, previewDir, budget);
      if (dataUrl) images.set(photo.id, dataUrl);
    }

    const galleryWithImages = gallery.filter((photo) => images.has(photo.id));
    const cover = galleryWithImages[0] ? images.get(galleryWithImages[0].id) : null;
    const siteName = album?.settings?.siteName || '时光轴相册';
    const siteNameEn = album?.settings?.siteNameEn || 'HOSHIKUZU';
    const html = renderReview({
      year: safeYear,
      summary,
      gallery: galleryWithImages,
      images,
      cover,
      siteName,
      siteNameEn,
    });

    return {
      ok: true,
      html,
      filename: `hoshikuzu-year-review-${safeYear}.html`,
      summary: {
        year: safeYear,
        photos: summary.total,
        worlds: summary.worlds,
        favorites: summary.favorites,
        images: budget.count,
        bytes: Buffer.byteLength(html, 'utf8'),
      },
    };
  }

  async exportYear(year, targetPath) {
    const built = await this.build(year);
    if (!built.ok) return built;
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, built.html, 'utf8');
    const stat = await fsp.stat(targetPath).catch(() => null);
    return {
      ok: true,
      path: targetPath,
      filename: built.filename,
      summary: { ...built.summary, bytes: stat ? stat.size : built.summary.bytes },
    };
  }
}

function renderReview({ year, summary, gallery, images, cover, siteName, siteNameEn }) {
  const months = summary.months;
  const maxMonth = Math.max(1, ...months);
  const monthBars = months
    .map(
      (count, index) => `
        <div class="month${count === 0 ? ' is-empty' : ''}">
          <span class="month__count">${count || ''}</span>
          <span class="month__bar" style="height:${Math.max(3, Math.round((count / maxMonth) * 100))}%"></span>
          <span class="month__label">${MONTHS[index].slice(0, 1)}</span>
        </div>`,
    )
    .join('');

  const worldCards = summary.topWorlds
    .map((world) => {
      const image = world.coverId ? images.get(world.coverId) : null;
      const initial = escapeHtml(world.name.trim().slice(0, 1) || '世');
      return `
        <article class="world">
          ${
            image
              ? `<img src="${image}" alt="" loading="lazy" />`
              : `<div class="world__empty"><span>${initial}</span></div>`
          }
          <div class="world__body">
            <strong>${escapeHtml(world.name)}</strong>
            <span>${world.photos} 张照片</span>
          </div>
        </article>`;
    })
    .join('');

  const figures = gallery
    .map((photo) => {
      const image = images.get(photo.id);
      const note = shortNote(photo.note);
      const world = photo.world?.name || '';
      return `
        <figure class="photo">
          <img src="${image}" alt="${escapeHtml(photo.alt || '')}" loading="lazy" />
          <figcaption>
            <span class="photo__meta">${escapeHtml(dateLabel(photo.capturedAt))}${
              world ? ` · ${escapeHtml(world)}` : ''
            }</span>
            ${note ? `<span class="photo__note">${escapeHtml(note)}</span>` : ''}
          </figcaption>
        </figure>`;
    })
    .join('');

  const range =
    summary.firstAt && summary.lastAt
      ? `${escapeHtml(dateLabel(summary.firstAt))} — ${escapeHtml(dateLabel(summary.lastAt))}`
      : '';
  const busiest = summary.busiestMonth
    ? `${MONTHS[summary.busiestMonth - 1]}最常回来`
    : '慢慢收集回忆';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
<meta name="referrer" content="no-referrer" />
<title>${escapeHtml(siteName)} · ${year} 年度回顾</title>
<style>
:root { color-scheme: dark; --cream:#f4ecdf; --muted:#b9aec4; --faint:#7f748c; --line:rgba(255,255,255,.13); --sakura:#f3aecb; --lilac:#c0a9ff; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#080611; color:var(--cream); }
body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; line-height:1.6; }
.review { width:min(1080px, calc(100% - 40px)); margin:0 auto; padding:64px 0 48px; }
.hero { position:relative; display:grid; grid-template-columns:minmax(0,1fr) minmax(260px, 380px); gap:44px; align-items:center; padding:56px 0 48px; border-bottom:1px solid var(--line); }
.eyebrow { margin:0 0 14px; font-size:10px; letter-spacing:.32em; text-transform:uppercase; color:var(--sakura); }
h1 { margin:0; font-family: Georgia, "Songti SC", serif; font-weight:500; line-height:1.05; letter-spacing:.02em; }
.year { display:block; font-size:clamp(64px, 10vw, 116px); background:linear-gradient(120deg, #fbeaf1, #f3aecb 45%, #c0a9ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
h1 .label { display:block; margin-top:8px; font-size:clamp(24px, 3.6vw, 38px); color:var(--cream); }
.lede { max-width:520px; margin:22px 0 0; font-size:14px; color:var(--muted); }
.hero__art { position:relative; aspect-ratio:4/5; overflow:hidden; border:1px solid var(--line); border-radius:22px; background:linear-gradient(160deg, rgba(243,174,203,.18), rgba(192,169,255,.08)); }
.hero__art img { width:100%; height:100%; object-fit:cover; display:block; }
.hero__art::after { content:""; position:absolute; inset:0; background:linear-gradient(180deg, transparent 55%, rgba(8,6,17,.55)); pointer-events:none; }
.hero__stamp { position:absolute; z-index:1; left:18px; bottom:16px; font-size:10px; letter-spacing:.22em; text-transform:uppercase; color:rgba(255,255,255,.78); }
.stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:14px; padding:32px 0 8px; }
.stat { padding:18px 16px; border:1px solid var(--line); border-radius:16px; background:rgba(255,255,255,.025); }
.stat span { display:block; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); }
.stat strong { display:block; margin-top:4px; font-family:Georgia, serif; font-size:34px; font-weight:500; }
.stat small { display:block; margin-top:2px; font-size:10px; color:var(--muted); }
section { padding:42px 0 0; }
.section-head { display:flex; align-items:baseline; gap:12px; margin-bottom:20px; }
.section-head span { font-size:10px; letter-spacing:.18em; color:var(--sakura); }
.section-head h2 { margin:0; font-family:Georgia, "Songti SC", serif; font-size:26px; font-weight:500; letter-spacing:.04em; }
.section-head p { margin:0 0 0 auto; font-size:10px; color:var(--faint); }
.months { display:flex; align-items:flex-end; gap:8px; height:150px; padding:16px 18px 10px; border:1px solid var(--line); border-radius:16px; background:rgba(255,255,255,.02); }
.month { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:6px; height:100%; min-width:0; }
.month__count { font-size:9px; color:var(--muted); }
.month__bar { width:100%; min-height:3px; border-radius:4px 4px 2px 2px; background:linear-gradient(180deg, rgba(243,174,203,.85), rgba(192,169,255,.3)); }
.month.is-empty .month__bar { background:rgba(255,255,255,.06); }
.month__label { font-size:9px; color:var(--faint); }
.worlds { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; }
.world { overflow:hidden; border:1px solid var(--line); border-radius:14px; background:rgba(255,255,255,.025); }
.world img, .world__empty { display:block; width:100%; aspect-ratio:16/10; object-fit:cover; }
.world__empty { display:grid; place-items:center; background:linear-gradient(140deg, rgba(243,174,203,.15), rgba(192,169,255,.07)); }
.world__empty span { font-family:Georgia, serif; font-size:34px; color:rgba(244,236,223,.55); }
.world__body { display:flex; flex-direction:column; gap:2px; padding:10px 12px 12px; }
.world__body strong { overflow:hidden; font-size:12px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
.world__body span { font-size:9.5px; color:var(--faint); }
.gallery { display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; }
.photo { margin:0; overflow:hidden; border:1px solid var(--line); border-radius:14px; background:rgba(255,255,255,.022); break-inside:avoid; }
.photo img { display:block; width:100%; aspect-ratio:4/3; object-fit:cover; background:#12101b; }
.photo figcaption { display:flex; flex-direction:column; gap:4px; padding:10px 12px 12px; }
.photo__meta { font-size:9px; letter-spacing:.04em; color:var(--faint); }
.photo__note { font-size:11px; line-height:1.55; color:var(--muted); overflow-wrap:anywhere; }
.closing { margin-top:48px; padding:30px 0 0; border-top:1px solid var(--line); display:flex; justify-content:space-between; gap:20px; align-items:flex-end; }
.closing p { margin:0; font-family:Georgia, "Songti SC", serif; font-size:18px; color:var(--cream); }
.closing span { font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); }
@media (max-width: 820px) {
  .review { width:min(100% - 28px, 680px); padding-top:34px; }
  .hero { grid-template-columns:1fr; gap:28px; padding-top:28px; }
  .hero__art { max-width:420px; aspect-ratio:4/3; }
  .stats { grid-template-columns:repeat(2, 1fr); }
  .worlds, .gallery { grid-template-columns:repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .worlds, .gallery { grid-template-columns:1fr; }
  .months { gap:4px; padding-left:10px; padding-right:10px; }
  .closing { flex-direction:column; align-items:flex-start; }
}
@media print {
  :root { color-scheme: light; }
  html, body { background:#fff; color:#211d27; }
  .review { width:100%; padding:0; }
  .hero__art, .month__bar, .world__empty { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .photo, .world, .stat, .months { border-color:#ddd; background:#fff; }
  .lede, .photo__note, .photo__meta, .world__body span, .stat small { color:#555; }
  .closing { border-color:#ddd; }
}
</style>
</head>
<body>
<main class="review">
  <header class="hero">
    <div>
      <p class="eyebrow">${escapeHtml(siteNameEn)} · YEAR IN REVIEW</p>
      <h1><span class="year">${year}</span><span class="label">年度回顾</span></h1>
      <p class="lede">${escapeHtml(siteName)} 在这一年留下了 ${summary.total} 张照片，走过 ${summary.worlds} 个世界。${escapeHtml(busiest)}。${range ? `从 ${range}。` : ''}</p>
    </div>
    ${
      cover
        ? `<div class="hero__art"><img src="${cover}" alt="" /><span class="hero__stamp">${escapeHtml(siteName)}</span></div>`
        : ''
    }
  </header>

  <div class="stats">
    <div class="stat"><span>照片</span><strong>${summary.total}</strong><small>MEMORIES</small></div>
    <div class="stat"><span>世界</span><strong>${summary.worlds}</strong><small>WORLDS</small></div>
    <div class="stat"><span>收藏</span><strong>${summary.favorites}</strong><small>FAVORITES</small></div>
    <div class="stat"><span>活跃月份</span><strong>${summary.activeMonths}</strong><small>OF 12</small></div>
  </div>

  <section>
    <div class="section-head"><span>01</span><h2>这一年的节奏</h2><p>${summary.notes} 段备注 · ${summary.tags} 个标签</p></div>
    <div class="months">${monthBars}</div>
  </section>

  ${
    summary.topWorlds.length
      ? `<section>
    <div class="section-head"><span>02</span><h2>常去的世界</h2><p>${summary.unlinked} 张照片未关联世界</p></div>
    <div class="worlds">${worldCards}</div>
  </section>`
      : ''
  }

  ${
    gallery.length
      ? `<section>
    <div class="section-head"><span>03</span><h2>光影切片</h2><p>${gallery.length} 张精选</p></div>
    <div class="gallery">${figures}</div>
  </section>`
      : ''
  }

  <footer class="closing">
    <p>愿每一次回归，都有新的光。</p>
    <span>${escapeHtml(siteNameEn)} · ${year} · MADE WITH HOSHIKUZU</span>
  </footer>
</main>
</body>
</html>`;
}

module.exports = {
  MAX_GALLERY_PHOTOS,
  YearReviewService,
  escapeHtml,
  pickGallery,
  summarize,
};
