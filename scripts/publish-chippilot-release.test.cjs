'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { publishRelease } = require('./publish-chippilot-release.cjs');

function fixture(t, badDigest = false, alreadyPublished = false) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chippilot-publish-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const bytes = Buffer.from('newly built CLI');
  fs.writeFileSync(path.join(output, 'cli.tgz'), bytes);
  const sha = 'a'.repeat(40), calls = [];
  let views = 0, tagSha = alreadyPublished ? sha : 'b'.repeat(40);
  const run = (command, args) => {
    assert.equal(command, 'gh');
    calls.push(args);
    if (args[0] === 'api' && args[1].includes('/releases/tags/')) {
      return JSON.stringify({ id: 1, assets: ++views === 1 && !alreadyPublished ? [] : [
        { id: 2, name: 'cli.tgz', size: bytes.length, digest: badDigest ? 'wrong' : 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') },
        { id: 3, name: 'obsolete.exe' },
      ] });
    }
    if (args[0] === 'api' && args[1].includes('/git/ref/tags/')) return JSON.stringify({ object: { sha: tagSha } });
    if (args.includes(`sha=${sha}`)) tagSha = sha;
    return '';
  };
  return { calls, args: { release: { repository: 'owner/repo', tag: 'v3', desktopVersion: '1.2.3' }, sha, output, files: ['cli.tgz'], notes: 'notes.md', run } };
}

test('keeps an existing release public and moves its tag only after upload and checksum verification', t => {
  const { calls, args } = fixture(t);
  publishRelease(args);
  assert.equal(calls.some(c => c.includes('create')), false);
  const upload = calls.findIndex(c => c[0] === 'release' && c[1] === 'upload');
  const remove = calls.findIndex(c => c.includes('DELETE'));
  const publish = calls.findIndex(c => c.includes('draft=false'));
  assert.equal(calls.some(c => c.includes('draft=true') || c.includes('--draft=true')), false);
  const tag = calls.findIndex(c => c.includes(`sha=${args.sha}`) && c.includes('force=true'));
  assert.ok(upload < tag && tag < remove && remove < publish);
  assert.ok(calls[upload].includes('--clobber'));
});

test('a digest mismatch does not move the source tag or complete publication', t => {
  const { calls, args } = fixture(t, true);
  assert.throws(() => publishRelease(args), /failed verification/);
  assert.equal(calls.some(c => c.includes('DELETE') || c.includes('draft=false')), false);
  assert.equal(calls.some(c => c.includes('force=true')), false);
});

test('authentication or network failures cannot be treated as a missing release', t => {
  const { args } = fixture(t);
  args.run = () => { const error = new Error('API failed'); error.stderr = 'HTTP 403'; throw error; };
  assert.throws(() => publishRelease(args), /API failed/);
});

test('a verified retry does not reupload assets or force an already correct tag', t => {
  const { calls, args } = fixture(t, false, true);
  publishRelease(args);
  assert.equal(calls.some(c => c[0] === 'release' && c[1] === 'upload'), false);
  assert.equal(calls.some(c => c.includes('force=true')), false);
  assert.ok(calls.some(c => c.includes('draft=false')));
});
