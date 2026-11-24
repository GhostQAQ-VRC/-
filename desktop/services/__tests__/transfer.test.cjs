'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const repository = require('../../library/repository.cjs');
const ingest = require('../../library/ingest.cjs');
const { TransferService, tokensEqual } = require('../transfer.cjs');

test('token comparison is length-safe', () => {
  assert.equal(tokensEqual('abc', 'abc'), true);
  assert.equal(tokensEqual('abc', 'abd'), false);
  assert.equal(tokensEqual('abc', 'abcd'), false);
  assert.equal(tokensEqual('', ''), false);
});

test('receiver accepts uploads, dedupes and rejects bad tokens', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-transfer-'));
  const root = path.join(base, 'library');
  const received = [];
  let service = null;
  try {
    await repository.ensureLibrary(root, { name: '传输测试库' });
    await fs.mkdir(path.join(root, 'pics'), { recursive: true });
    const source = path.join(root, 'pics', 'source.png');
    await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#3366aa' },
    })
      .png()
      .toFile(source);

    service = new TransferService({
      getRoot: () => root,
      importReceived: (libraryRoot, tempPath, name, maxEdge) =>
        ingest.importReceivedFile(libraryRoot, tempPath, name, { previewMaxEdge: maxEdge }),
      getPreviewMaxEdge: async () => 1600,
      onIncoming: (draft) => received.push(draft),
    });

    const started = await service.startReceiver({ port: 0, token: 'secret-token' });
    assert.equal(started.ok, true);
    const port = service.status().port;
    assert.ok(port > 0);

    const wrong = await service.testTarget({
      target: `127.0.0.1:${port}`,
      token: 'wrong-token',
    });
    assert.equal(wrong.ok, false);

    const ping = await service.testTarget({
      target: `127.0.0.1:${port}`,
      token: 'secret-token',
    });
    assert.equal(ping.ok, true);
    assert.equal(ping.libraryName, '传输测试库');

    const send = await service.send({
      target: `127.0.0.1:${port}`,
      token: 'secret-token',
      items: [{ id: 'p1', name: 'source.png', libraryPath: 'pics/source.png' }],
    });
    assert.equal(send.ok, true);
    assert.equal(send.sent, 1);
    assert.equal(received.length, 1);
    assert.ok(received[0].libraryPath.startsWith('_inbox/transfer/'));

    const receivedPath = path.join(root, received[0].libraryPath);
    const stat = await fs.stat(receivedPath);
    assert.ok(stat.size > 0);
    assert.ok(received[0].previewPath);

    const duplicate = await service.send({
      target: `127.0.0.1:${port}`,
      token: 'secret-token',
      items: [{ id: 'p1', name: 'source.png', libraryPath: 'pics/source.png' }],
    });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.results[0].duplicate, true);

    const traversal = await service.send({
      target: `127.0.0.1:${port}`,
      token: 'secret-token',
      items: [{ id: 'x', name: 'evil.png', libraryPath: '../outside.png' }],
    });
    assert.equal(traversal.ok, false);
    assert.match(traversal.results[0].error, /路径/);
  } finally {
    if (service) await service.stopReceiver();
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('receiver rejects missing token and bad content length', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-transfer-'));
  const root = path.join(base, 'library');
  const service = new TransferService({
    getRoot: () => root,
    importReceived: () => {
      throw new Error('should not be called');
    },
    getPreviewMaxEdge: async () => 1600,
  });
  try {
    await repository.ensureLibrary(root, { name: '测试库' });
    const started = await service.startReceiver({ port: 0, token: 'abc' });
    assert.equal(started.ok, true);
    const port = service.status().port;

    const response = await fetch(`http://127.0.0.1:${port}/api/upload?name=x.png`, {
      method: 'POST',
      headers: { 'content-length': '4' },
      body: 'test',
    });
    assert.equal(response.status, 401);

    const noLength = await fetch(`http://127.0.0.1:${port}/api/upload?name=x.png`, {
      method: 'POST',
      headers: { authorization: 'Bearer abc' },
      body: '',
    });
    assert.equal(noLength.status, 411);
  } finally {
    await service.stopReceiver();
    await fs.rm(base, { recursive: true, force: true });
  }
});
