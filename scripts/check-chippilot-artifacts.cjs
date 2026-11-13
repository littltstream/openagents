'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const runId = process.env.ARTIFACTS_RUN_ID;
let sha = process.env.GITHUB_SHA;
if (runId) {
  if (!/^\d+$/.test(runId)) throw new Error('Invalid artifact workflow run ID');
  const repo = process.env.GITHUB_REPOSITORY;
  const api = route => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${route}`], { encoding: 'utf8' }));
  const run = api(`actions/runs/${runId}`);
  if (run.repository.full_name !== repo || run.head_repository.full_name !== repo
      || run.path !== '.github/workflows/chippilot-release.yml' || run.status !== 'completed') {
    throw new Error('Artifacts must come from a completed distribution run in this fork');
  }
  const builds = api(`actions/runs/${runId}/jobs?per_page=100`).jobs
    .filter(job => job.name === 'cli' || job.name.startsWith('desktop ('));
  if (builds.length !== 5 || builds.some(job => job.conclusion !== 'success')) {
    throw new Error('All five CLI/platform build jobs must have succeeded');
  }
  sha = run.head_sha;
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Invalid artifact source commit');
  execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', sha], { stdio: 'inherit' });
  const changed = execFileSync('git', ['diff', '--name-only', sha, process.env.GITHUB_SHA], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const publisherFiles = new Set([
    '.github/workflows/chippilot-release.yml', 'scripts/check-chippilot-artifacts.cjs',
    'scripts/publish-chippilot.cjs', 'scripts/publish-chippilot-release.cjs', 'scripts/publish-chippilot-release.test.cjs',
  ]);
  if (changed.some(file => !publisherFiles.has(file))) {
    throw new Error('Application code changed since those builds; rebuild every platform');
  }
}
if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('Invalid build source commit');
fs.appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
console.log(`Validated platform build source ${sha}`);
