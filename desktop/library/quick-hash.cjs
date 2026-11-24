'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;

/**
 * Content identity for a photo. Reading the full file would be too slow for a
 * large VRChat screenshot library, so hash size + head + tail. Collisions are
 * practically impossible for real photos and moved files keep their identity.
 */
async function quickContentHash(filePath, size) {
  const handle = await fs.open(filePath, 'r');
  try {
    const headLength = Math.min(size, HEAD_BYTES);
    const tailLength = Math.min(size, TAIL_BYTES);
    const head = Buffer.alloc(headLength);
    if (headLength > 0) await handle.read(head, 0, headLength, 0);
    const tail = Buffer.alloc(tailLength);
    if (tailLength > 0) await handle.read(tail, 0, tailLength, Math.max(0, size - tailLength));

    const hash = crypto.createHash('sha1');
    hash.update(String(size));
    hash.update(head);
    hash.update(tail);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

module.exports = { quickContentHash, HEAD_BYTES, TAIL_BYTES };
