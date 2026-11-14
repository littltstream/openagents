'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { publishRelease } = require('./publish-chippilot-release.cjs');

function fixture(t, badDigest = false, alreadyPublished = false, { newDraft = false, missingTag = false } = {}) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chippilot-publish-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const bytes = Buffer.from('newly built CLI');
  fs.writeFileSync(path.join(output, 'cli.tgz'), bytes);
  const sha = 'a'.repeat(40), calls = [];
  let created = !newDraft, uploaded = alreadyPublished, tagSha = missingTag ? null : alreadyPublished ? sha : 'b'.repeat(40);
  const releaseData = () => ({ id: 1, tag_name: 'v3', draft: newDraft, assets: uploaded ? [
    { id: 2, name: 'cli.tgz', size: bytes.length, digest: badDigest ? 'wrong' : 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') },
    { id: 3, name: 'obsolete.exe' },
  ] : [] });
  const run = (command, args) => {
    assert.equal(command, 'gh');
    calls.push(args);
    if (args[0] === 'api' && args.includes('repos/owner/repo/releases?per_page=100')) {
      assert.ok(args.includes('--paginate') && args.includes('--slurp'));
      return JSON.stringify([created ? [releaseData()] : []]);
    }
    if (args[0] === 'release' && args[1] === 'create') created = true;
    if (args[0] === 'release' && args[1] === 'upload') uploaded = true;
    if (args[0] === 'api' && args[1] === 'repos/owner/repo/releases/1') return JSON.stringify(releaseData());
    if (args[0] === 'api' && args[1].includes('/git/ref/tags/')) {
      if (!tagSha) { const error = new Error('Missing draft tag'); error.stderr = 'HTTP 404'; throw error; }
      return JSON.stringify({ object: { sha: tagSha } });
    }
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

test('publishes a new draft by ID and creates its missing source tag after verification', t => {
  const { calls, args } = fixture(t, false, false, { newDraft: true, missingTag: true });
  publishRelease(args);
  assert.ok(calls.some(c => c[0] === 'release' && c[1] === 'create'));
  assert.ok(calls.some(c => c[0] === 'api' && c[1] === 'repos/owner/repo/releases/1'));
  assert.equal(calls.some(c => c.some(a => a.includes('/releases/tags/'))), false);
  const upload = calls.findIndex(c => c[0] === 'release' && c[1] === 'upload');
  const verify = calls.findIndex(c => c[0] === 'api' && c[1] === 'repos/owner/repo/releases/1');
  const tag = calls.findIndex(c => c.includes('POST') && c.includes('ref=refs/tags/v3'));
  const publish = calls.findIndex(c => c.includes('draft=false'));
  assert.ok(upload < verify && verify < tag && tag < publish);
});
