'use strict';

const zlib = require('node:zlib');
const fs = require('node:fs/promises');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_CHUNK_TYPES = new Set(['tEXt', 'zTXt', 'iTXt']);

function decodeText(buffer) {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('\uFFFD') ? buffer.toString('latin1') : utf8;
}

function parseTextChunk(type, data) {
  const nullIndex = data.indexOf(0);
  if (nullIndex <= 0) return null;
  const keyword = data.toString('latin1', 0, nullIndex);

  if (type === 'tEXt') {
    return { keyword, text: decodeText(data.subarray(nullIndex + 1)) };
  }

  if (type === 'zTXt') {
    if (data.length < nullIndex + 3) return null;
    const compressed = data.subarray(nullIndex + 2);
    try {
      return { keyword, text: decodeText(zlib.inflateSync(compressed)) };
    } catch {
      return null;
    }
  }

  // iTXt: keyword \0 compressionFlag(1) compressionMethod(1) language \0
  // translatedKeyword \0 utf8Text
  let cursor = nullIndex + 1;
  if (data.length < cursor + 2) return null;
  const compressionFlag = data[cursor];
  cursor += 2; // flag + method
  const languageEnd = data.indexOf(0, cursor);
  if (languageEnd < 0) return null;
  cursor = languageEnd + 1;
  const translatedEnd = data.indexOf(0, cursor);
  if (translatedEnd < 0) return null;
  cursor = translatedEnd + 1;
  let textBuffer = data.subarray(cursor);
  if (compressionFlag === 1) {
    try {
      textBuffer = zlib.inflateSync(textBuffer);
    } catch {
      return null;
    }
  }
  return { keyword, text: textBuffer.toString('utf8') };
}

/**
 * Read every tEXt / zTXt / iTXt chunk from a PNG without decoding the image.
 * VRChat writes its XMP packet to iTXt keyword "XML:com.adobe.xmp"; VRCX adds
 * a "Description" chunk with JSON. Both end up in the returned map.
 */
async function readPngTextChunks(filePath, options = {}) {
  const maxTextBytes = options.maxTextBytes ?? 4 * 1024 * 1024;
  const maxChunks = options.maxChunks ?? 10000;
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const size = stat.size;
    if (size < 8) return {};

    const signature = Buffer.alloc(8);
    await handle.read(signature, 0, 8, 0);
    if (!signature.equals(PNG_SIGNATURE)) return {};

    const chunks = {};
    const header = Buffer.alloc(8);
    let offset = 8;
    let guard = 0;

    while (offset + 12 <= size && guard < maxChunks) {
      guard += 1;
      const read = await handle.read(header, 0, 8, offset);
      if (read.bytesRead < 8) break;

      const length = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (!/^[A-Za-z]{4}$/.test(type)) break;

      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > size) break;
      if (type === 'IEND') break;

      if (TEXT_CHUNK_TYPES.has(type) && length > 0 && length <= maxTextBytes) {
        const data = Buffer.alloc(length);
        await handle.read(data, 0, length, dataStart);
        const parsed = parseTextChunk(type, data);
        if (parsed && parsed.keyword) {
          const previous = chunks[parsed.keyword];
          if (!previous || previous.length < parsed.text.length) {
            chunks[parsed.keyword] = parsed.text;
          }
        }
      }

      offset = dataEnd + 4;
    }

    return chunks;
  } finally {
    await handle.close();
  }
}

module.exports = {
  PNG_SIGNATURE,
  readPngTextChunks,
  parseTextChunk,
};
