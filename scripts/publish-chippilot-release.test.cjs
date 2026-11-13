'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { publishRelease } = require('./publish-chippilot-release.cjs');

function fixture(t, badDigest = false) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chippilot-publish-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const bytes = Buffer.from('newly built CLI');
  fs.writeFileSync(path.join(output, 'cli.tgz'), bytes);
  const sha = 'a'.repeat(40), calls = [];
  let views = 0;
  const run = (command, args) => {
    assert.equal(command, 'gh');
    calls.push(args);
    if (args[0] === 'api' && args[1].includes('/releases/tags/')) {
      return JSON.stringify({ id: 1, assets: ++views === 1 ? [] : [
        { id: 2, name: 'cli.tgz', size: bytes.length, digest: badDigest ? 'wrong' : 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') },
        { id: 3, name: 'obsolete.exe' },
      ] });
    }
    if (args[0] === 'api' && args[1].includes('/git/ref/tags/')) return JSON.stringify({ object: { sha } });
    return '';
  };
  return { calls, args: { release: { repository: 'owner/repo', tag: 'v3', desktopVersion: '1.2.3' }, sha, output, files: ['cli.tgz'], notes: 'notes.md', run } };
}

test('replaces an existing release only after upload and checksum verification, then publishes the new tag', t => {
  const { calls, args } = fixture(t);
  publishRelease(args);
  assert.equal(calls.some(c => c.includes('create')), false);
  const upload = calls.findIndex(c => c[0] === 'release' && c[1] === 'upload');
  const remove = calls.findIndex(c => c.includes('DELETE'));
  const publish = calls.findIndex(c => c.includes('draft=false'));
  const draft = calls.find(c => c.includes('draft=true'));
  assert.ok(draft.includes('tag_name=v3') && draft.includes('repos/owner/repo/releases/1'));
  assert.ok(calls.slice(0, upload).some(c => c.includes(`sha=${args.sha}`) && c.includes('force=true')));
  assert.ok(upload < remove && remove < publish);
  assert.ok(calls[upload].includes('--clobber'));
});

test('a digest mismatch leaves the replacement unpublished and does not delete old assets', t => {
  const { calls, args } = fixture(t, true);
  assert.throws(() => publishRelease(args), /failed verification/);
  assert.equal(calls.some(c => c.includes('DELETE') || c.includes('draft=false')), false);
});

test('authentication or network failures cannot be treated as a missing release', t => {
  const { args } = fixture(t);
  args.run = () => { const error = new Error('API failed'); error.stderr = 'HTTP 403'; throw error; };
  assert.throws(() => publishRelease(args), /API failed/);
});
