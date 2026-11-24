'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const sharp = require('sharp');

const {
  analyzeText,
  parseFilenameDate,
  readPhotoMetadata,
} = require('../metadata.cjs');
const { readPngTextChunks } = require('../png-chunks.cjs');

const WORLD_A = 'wrld_12345678-1234-1234-1234-123456789abc';
const WORLD_B = 'wrld_abcdefab-cdef-abcd-efab-cdefabcdefab';

function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer);
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function insertTextChunk(pngBuffer, keyword, text) {
  const payload = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(text, 'utf8'),
  ]);
  const chunk = makeChunk('iTXt', payload);
  // IEND is always the last 12 bytes: length(0) + "IEND" + crc.
  return Buffer.concat([pngBuffer.subarray(0, pngBuffer.length - 12), chunk, pngBuffer.subarray(pngBuffer.length - 12)]);
}

test('XMP world id and creation date are extracted', () => {
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description
    xmlns:vrchat="http://vrchat.com/xmp/1.0/"
    vrchat:WorldID="${WORLD_A}"
    vrchat:WorldName="Sakura Shrine"
    xmp:CreateDate="2024-05-01T20:30:45+09:00" /></rdf:RDF></x:xmpmeta>`;

  const result = analyzeText({
    xmp,
    fileName: 'VRChat_2024-05-01_20-30-45.123_1920x1080.png',
    mtimeMs: Date.UTC(2025, 0, 1),
  });

  assert.equal(result.worldId, WORLD_A);
  assert.equal(result.worldName, 'Sakura Shrine');
  assert.equal(result.metaSource, 'xmp');
  assert.equal(result.capturedAt, '2024-05-01T11:30:45.000Z');
});

test('VRCX Description JSON supplies world, author and timestamp', () => {
  const description = JSON.stringify({
    application: 'VRCX',
    version: 1,
    author: { id: 'usr_test', displayName: 'Traveller' },
    world: {
      id: WORLD_B,
      name: 'Neon Alley',
      instanceId: `${WORLD_B}:48291~region(jp)`,
    },
    players: [],
    Timestamp: '2024-06-02T21:15:30.123',
  });

  const result = analyzeText({
    description,
    fileName: 'VRChat_2024-06-02_21-15-30.123_1920x1080.png',
  });

  assert.equal(result.worldId, WORLD_B);
  assert.equal(result.worldName, 'Neon Alley');
  assert.equal(result.worldInstanceId, `${WORLD_B}:48291~region(jp)`);
  assert.equal(result.metaSource, 'json');
  assert.equal(new Date(result.capturedAt).getFullYear(), 2024);
});

test('VRChat filename is used when there is no metadata', () => {
  const result = analyzeText({
    fileName: 'VRChat_2024-07-03_18-05-09.456_1920x1080.png',
    mtimeMs: Date.UTC(2026, 0, 1),
  });
  assert.equal(result.dateSource, 'filename');
  assert.equal(result.metaSource, 'filename');
  const date = new Date(result.capturedAt);
  assert.equal(date.getFullYear(), 2024);
  assert.equal(date.getMonth() + 1, 7);
  assert.equal(date.getDate(), 3);
  assert.equal(date.getHours(), 18);
});

test('world id in the filename is recognized', () => {
  const result = parseFilenameDate(`VRChat_2024-07-03_18-05-09.456_${WORLD_A}.png`);
  assert.ok(result);
  const analyzed = analyzeText({
    fileName: `VRChat_2024-07-03_18-05-09.456_${WORLD_A}.png`,
  });
  assert.equal(analyzed.worldId, WORLD_A);
});

test('PNG iTXt XMP chunk round-trips and drives metadata', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-meta-'));
  const filePath = path.join(tmpDir, 'VRChat_2024-08-09_10-11-12.000_2x2.png');
  try {
    const base = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#223344' },
    })
      .png()
      .toBuffer();

    const xmp = `<x:xmpmeta><rdf:RDF><rdf:Description WorldID="${WORLD_B}" WorldName="Moon Garden" xmp:CreateDate="2024-08-09T10:11:12+02:00" /></rdf:RDF></x:xmpmeta>`;
    await fs.writeFile(filePath, insertTextChunk(base, 'XML:com.adobe.xmp', xmp));

    const chunks = await readPngTextChunks(filePath);
    assert.equal(chunks['XML:com.adobe.xmp'], xmp);

    const info = await readPhotoMetadata(filePath, { fileName: path.basename(filePath) });
    assert.equal(info.worldId, WORLD_B);
    assert.equal(info.worldName, 'Moon Garden');
    assert.equal(info.metaSource, 'xmp');
    assert.equal(info.capturedAt, '2024-08-09T08:11:12.000Z');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('plain images fall back to file mtime', () => {
  const mtime = Date.UTC(2024, 2, 4, 5, 6, 7);
  const result = analyzeText({ fileName: 'holiday.jpg', mtimeMs: mtime });
  assert.equal(result.dateSource, 'mtime');
  assert.equal(result.capturedAt, new Date(mtime).toISOString());
});
