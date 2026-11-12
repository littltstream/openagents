'use strict';
// One-time reset explicitly requested by the repository owner. Validate every
// recorded release and ref before deleting any of them; never match by prefix.
const { execFileSync } = require('node:child_process');
const release = require('../chippilot-release.json');
const repository = 'littltstream/openagents';
if (process.env.GITHUB_REPOSITORY !== repository || release.repository !== repository ||
    release.tag !== 'chippilot-v1.1.14.1' || process.env.CHIPPILOT_RESET_RELEASE_SERIES !== '2026-11-12') {
  throw new Error('This one-time reset is only authorized for the recorded repository and new .1 release');
}
const releases = [
  { id: 442450401, tag: 'chippilot-v1.1.14.3' },
  { id: 442453714, tag: 'chippilot-v1.1.14.4' },
];
const tags = [
  { tag: 'chippilot-v1.1.14.1', sha: '0485e3d0d3bfcd8506ecca8cdfa06a79e2d5c33f' },
  { tag: 'chippilot-v1.1.14.2', sha: '6cc7721f14a93942ec9d0679f27923f6fc9b4423' },
  { tag: 'chippilot-v1.1.14.3', sha: 'f5a33aa8d1f10c3119fd51c6ddd47537e198657e' },
  { tag: 'chippilot-v1.1.14.4', sha: 'c253e1719975c2ef56c38c1d4b56f22e8758ce60' },
];
const api = endpoint => JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], { encoding: 'utf8' }));
for (const expected of releases) {
  const actual = api(`releases/${expected.id}`);
  if (actual.id !== expected.id || actual.tag_name !== expected.tag || actual.draft) throw new Error(`Release changed: ${expected.tag}`);
}
for (const expected of tags) {
  const actual = api(`git/ref/tags/${expected.tag}`);
  if (actual.object.sha !== expected.sha || actual.object.type !== 'commit') throw new Error(`Tag changed: ${expected.tag}`);
}
for (const expected of releases) {
  execFileSync('gh', ['api', '--method', 'DELETE', `repos/${repository}/releases/${expected.id}`], { stdio: 'inherit' });
  console.log(`Removed release ${expected.tag}`);
}
for (const expected of tags) {
  execFileSync('gh', ['api', '--method', 'DELETE', `repos/${repository}/git/refs/tags/${expected.tag}`], { stdio: 'inherit' });
  console.log(`Removed old tag ${expected.tag}`);
}
