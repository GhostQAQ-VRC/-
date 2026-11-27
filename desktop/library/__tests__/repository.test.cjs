'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const repository = require('../repository.cjs');

test('resolveInside rejects traversal and absolute paths', () => {
  const root = path.resolve('/tmp/hoshikuzu-library');
  assert.equal(repository.resolveInside(root, '..\\secret.jpg'), null);
  assert.equal(repository.resolveInside(root, '../secret.jpg'), null);
  assert.equal(repository.resolveInside(root, ''), null);
  assert.equal(repository.resolveInside(root, 'photos/a.jpg'), path.join(root, 'photos', 'a.jpg'));
});

test('resolveInsideDir confines managed deletes to the inbox folder', () => {
  const root = path.resolve('/tmp/hoshikuzu-library');
  // The old prefix check accepted this because it starts with "_inbox/".
  assert.equal(repository.resolveInsideDir(root, '_inbox/../original.jpg', '_inbox'), null);
  assert.equal(repository.resolveInsideDir(root, '_inbox/../.hoshikuzu/library.json', '_inbox'), null);
  assert.equal(repository.resolveInsideDir(root, '_inboxish/a.jpg', '_inbox'), null);
  assert.equal(repository.resolveInsideDir(root, '../_inbox/a.jpg', '_inbox'), null);
  assert.equal(
    repository.resolveInsideDir(root, '_inbox/2026-01-01/a.jpg', '_inbox'),
    path.join(root, '_inbox', '2026-01-01', 'a.jpg'),
  );
  assert.equal(
    repository.resolveInsideDir(root, '_inbox\\2026-01-01\\a.jpg', '_inbox'),
    path.join(root, '_inbox', '2026-01-01', 'a.jpg'),
  );
});
