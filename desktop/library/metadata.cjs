'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { readPngTextChunks } = require('./png-chunks.cjs');

const WORLD_ID_STRICT =
  /wrld_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const WORLD_ID_LOOSE = /wrld_[0-9a-fA-F-]{20,}/;
const USER_ID_STRICT =
  /usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const INSTANCE_RE = /wrld_[0-9a-fA-F-]{20,}:[0-9]+[^\s"'<>,]*/;
const DATE_RE =
  /(20\d{2})[-/:](0[1-9]|1[0-2])[-/:](0[1-9]|[12]\d|3[01])[T _-](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?/;
const VRC_FILENAME_RE =
  /VRChat[_-](\d{4})-(\d{2})-(\d{2})[_-](\d{2})-(\d{2})-(\d{2})(?:\.(\d{1,9}))?/i;

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function findWorldId(text) {
  if (!text) return undefined;
  const strict = text.match(WORLD_ID_STRICT);
  if (strict) return strict[0];
  const loose = text.match(WORLD_ID_LOOSE);
  return loose ? loose[0] : undefined;
}

function isPlausibleDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  return year >= 2000 && year <= 2100;
}

function buildDate(year, month, day, hour, minute, second, fraction, timezone) {
  const ms = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;
  let date;
  if (timezone && (timezone === 'Z' || /^[+-]/.test(timezone))) {
    const normalized = timezone === 'Z' ? 'Z' : timezone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    const frac = fraction ? `.${fraction}` : '';
    date = new Date(
      `${year}-${month}-${day}T${hour}:${minute}:${second}${frac}${normalized}`,
    );
  } else {
    // VRChat filenames and most camera clocks are local wall-clock time.
    date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      ms,
    );
  }
  return isPlausibleDate(date) ? date.toISOString() : undefined;
}

function parseDateLike(value) {
  if (!value) return undefined;
  if (value instanceof Date) return isPlausibleDate(value) ? value.toISOString() : undefined;
  if (typeof value === 'number') {
    const date = new Date(value);
    return isPlausibleDate(date) ? date.toISOString() : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const match = value.match(DATE_RE);
  if (match) {
    return buildDate(
      match[1],
      match[2],
      match[3],
      match[4],
      match[5],
      match[6],
      match[7],
      match[8],
    );
  }
  const parsed = new Date(value);
  return isPlausibleDate(parsed) ? parsed.toISOString() : undefined;
}

function parseFilenameDate(fileName) {
  const match = fileName.match(VRC_FILENAME_RE);
  if (!match) return undefined;
  return buildDate(match[1], match[2], match[3], match[4], match[5], match[6], match[7]);
}

function parseJsonCandidate(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to the balanced-substring attempt.
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function searchObject(value, predicate, depth = 0, seen = new Set()) {
  if (value == null || depth > 8) return undefined;
  if (typeof value === 'string') return predicate('', value);
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchObject(item, predicate, depth + 1, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  for (const [key, child] of Object.entries(value)) {
    const direct = predicate(key, child);
    if (direct !== undefined) return direct;
    const nested = searchObject(child, predicate, depth + 1, seen);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function findWorldIdInJson(json) {
  return searchObject(json, (key, value) => {
    if (typeof value !== 'string') return undefined;
    if (/^(world.?id|worldid)$/i.test(key)) {
      const match = value.match(WORLD_ID_STRICT) || value.match(WORLD_ID_LOOSE);
      if (match) return match[0];
    }
    const anywhere = value.match(WORLD_ID_STRICT);
    return anywhere ? anywhere[0] : undefined;
  });
}

function findWorldNameInJson(json) {
  return searchObject(json, (key, value) => {
    if (/^(world.?name|worldname)$/i.test(key) && typeof value === 'string' && value.trim()) {
      return decodeEntities(value.trim());
    }
    if (/^world$/i.test(key) && value && typeof value === 'object') {
      const name = value.name ?? value.Name ?? value.worldName;
      if (typeof name === 'string' && name.trim()) return decodeEntities(name.trim());
    }
    return undefined;
  });
}

function findInstanceInJson(json) {
  return searchObject(json, (key, value) => {
    if (/^instance.?id$/i.test(key) && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (/^world$/i.test(key) && value && typeof value === 'object') {
      const instance = value.instanceId ?? value.InstanceId ?? value.instance;
      if (typeof instance === 'string' && instance.trim()) return instance.trim();
    }
    return undefined;
  });
}

function findTimestampInJson(json) {
  return searchObject(json, (key, value) => {
    if (!/^(timestamp|capturedat|createdate|datetimeoriginal|datetime|date)$/i.test(key)) {
      return undefined;
    }
    return parseDateLike(value);
  });
}

/**
 * VRCX stores the players who were in the instance on the screenshot's
 * Description JSON. Only IDs/display names are extracted; profile data and
 * avatars are resolved later by the desktop player library.
 */
function findPlayersInJson(json) {
  const players = [];
  const seen = new Set();
  searchObject(json, (key, value) => {
    if (!/^(players|playerlist|playerslist)$/i.test(key) || !Array.isArray(value)) {
      return undefined;
    }
    for (const item of value.slice(0, 64)) {
      const rawId =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object'
            ? item.id ?? item.userId ?? item.user_id
            : '';
      const match = typeof rawId === 'string' ? rawId.match(USER_ID_STRICT) : null;
      if (!match) continue;
      const id = match[0].toLowerCase();
      if (seen.has(id)) continue;
      const rawName =
        item && typeof item === 'object'
          ? item.displayName ?? item.name ?? item.username
          : '';
      const displayName =
        typeof rawName === 'string' && rawName.trim()
          ? decodeEntities(rawName.trim()).slice(0, 80)
          : id.slice(0, 18);
      seen.add(id);
      players.push({ id, displayName });
      if (players.length >= 32) break;
    }
    return players.length ? players : undefined;
  });
  return players;
}

function findNameInText(text) {
  if (!text) return undefined;
  const patterns = [
    /(?:^|[\s<"'[{,])(?:vrchat:)?worldName\s*["']?\s*[=:]\s*["']([^"'\n<>]{1,120})["']/i,
    /(?:^|[\s<"'[{,])(?:vrchat:)?world_name\s*["']?\s*[=:]\s*["']([^"'\n<>]{1,120})["']/i,
    /<[^>]*WorldName[^>]*>([^<]{1,120})</i,
    /"world"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]{1,120})"/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1].trim()) return decodeEntities(match[1].trim());
  }
  return undefined;
}

function safeStringify(value) {
  try {
    const text = JSON.stringify(value, (key, child) => {
      if (/^(makernote|thumbnail|thumb|image|sourcefile|rawdata)$/i.test(key)) return undefined;
      if (typeof child === 'string' && child.length > 120000) return child.slice(0, 120000);
      return child;
    });
    return text && text.length > 600000 ? text.slice(0, 600000) : text || '';
  } catch {
    return '';
  }
}

function pickExifDate(parsed) {
  if (!parsed) return undefined;
  const keys = ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'DateTimeDigitized', 'DateTime'];
  for (const key of keys) {
    const iso = parseDateLike(parsed[key]);
    if (iso) return iso;
  }
  return undefined;
}

/**
 * Pure metadata analysis, split out so the recognition rules can be unit
 * tested without image files.
 */
function analyzeText(input = {}) {
  const xmp = input.xmp || '';
  const description = input.description || '';
  const exifText = input.exifText || '';
  const fileName = input.fileName || '';
  const mtimeMs = input.mtimeMs ?? Date.now();

  const combined = [xmp, description, exifText].filter(Boolean).join('\n');
  const json = parseJsonCandidate(description) || parseJsonCandidate(exifText);

  const worldId =
    findWorldId(combined) ||
    (json ? findWorldIdInJson(json) : undefined) ||
    findWorldId(fileName);
  const worldName =
    findNameInText(xmp) ||
    findNameInText(combined) ||
    (json ? findWorldNameInJson(json) : undefined);
  const worldInstanceId =
    (combined.match(INSTANCE_RE) || [])[0] ||
    (json ? findInstanceInJson(json) : undefined);

  let capturedAt;
  let dateSource = 'mtime';

  const xmpDate = parseDateLike(xmp);
  const descriptionDate = parseDateLike(description);
  const exifDate = input.exifDate || (json ? findTimestampInJson(json) : undefined);
  const filenameDate = parseFilenameDate(fileName);
  const fallbackDate = parseDateLike(Number(mtimeMs)) || new Date().toISOString();

  if (xmpDate) {
    capturedAt = xmpDate;
    dateSource = 'xmp';
  } else if (descriptionDate) {
    capturedAt = descriptionDate;
    dateSource = 'json';
  } else if (exifDate) {
    capturedAt = exifDate;
    dateSource = 'exif';
  } else if (filenameDate) {
    capturedAt = filenameDate;
    dateSource = 'filename';
  } else {
    capturedAt = fallbackDate;
    dateSource = 'mtime';
  }

  let metaSource = 'mtime';
  if (worldId && xmp && xmp.includes(worldId)) metaSource = 'xmp';
  else if (worldId && description && description.includes(worldId)) metaSource = 'json';
  else if (worldId && exifText && exifText.includes(worldId)) metaSource = 'exif';
  else if (dateSource !== 'mtime' && dateSource !== 'filename') metaSource = dateSource;
  else if (filenameDate) metaSource = 'filename';

  return {
    capturedAt,
    metaSource,
    dateSource,
    worldId,
    worldName,
    worldInstanceId,
    players: findPlayersInJson(json),
    alt: path.parse(fileName || 'photo').name || '存储库照片',
    diagnostics: {
      chunkKeys: input.chunkKeys || [],
      xmpBytes: xmp.length,
      descriptionBytes: description.length,
      exifBytes: exifText.length,
      jsonParsed: Boolean(json),
    },
  };
}

/** Read metadata from a PNG or an EXIF/XMP-capable image. */
async function readPhotoMetadata(filePath, options = {}) {
  const fileName = options.fileName || path.basename(filePath);
  const mtimeMs = options.mtimeMs ?? (await fs.stat(filePath)).mtimeMs;
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.png') {
    let chunks = {};
    try {
      chunks = await readPngTextChunks(filePath);
    } catch {
      chunks = {};
    }
    const xmp =
      chunks['XML:com.adobe.xmp'] || chunks['xmp'] || chunks['XMP'] || '';
    const description =
      chunks['Description'] ||
      chunks['description'] ||
      chunks['Comment'] ||
      chunks['VRChat'] ||
      '';
    return analyzeText({
      xmp,
      description,
      fileName,
      mtimeMs,
      chunkKeys: Object.keys(chunks),
    });
  }

  let parsed = null;
  let xmpText = '';
  try {
    // exifr is pure JS and supports JPEG/HEIC/TIFF/WebP etc.
    const exifr = require('exifr');
    parsed = await exifr.parse(filePath, {
      xmp: true,
      iptc: false,
      interop: false,
      translateValues: false,
      reviveValues: false,
      mergeOutput: true,
    });
    try {
      const xmp = await exifr.xmp(filePath);
      if (xmp) xmpText = typeof xmp === 'string' ? xmp : safeStringify(xmp);
    } catch {
      xmpText = '';
    }
  } catch {
    parsed = null;
  }

  const exifText = safeStringify(parsed);
  return analyzeText({
    xmp: xmpText,
    description: exifText,
    fileName,
    mtimeMs,
    exifDate: pickExifDate(parsed),
    chunkKeys: parsed ? Object.keys(parsed).slice(0, 40) : [],
  });
}

module.exports = {
  WORLD_ID_STRICT,
  WORLD_ID_LOOSE,
  USER_ID_STRICT,
  analyzeText,
  findPlayersInJson,
  findWorldId,
  findWorldIdInJson,
  findWorldNameInJson,
  parseDateLike,
  parseFilenameDate,
  readPhotoMetadata,
  safeStringify,
};
