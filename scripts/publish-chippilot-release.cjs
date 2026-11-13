'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function publishRelease({ release, sha, output, files, notes, run = execFileSync }) {
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('A full source commit SHA is required');
  const repo = `repos/${release.repository}`;
  const gh = (args) => run('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const api = (route) => JSON.parse(gh(['api', `${repo}/${route}`]));
  let existing;
  try { existing = api(`releases/tags/${release.tag}`); }
  catch (error) {
    if (!/HTTP 404/.test(String(error.stderr))) throw error;
  }
  if (existing?.immutable) throw new Error('The existing release is immutable and cannot be replaced');

  // All platform builds and local asset checks have succeeded before this call.
  // Hide the old release while replacing it so a mixed set is never published.
  if (existing) {
    // GitHub may rename an unpublished release to "untagged-*" unless the
    // draft update explicitly carries its tag. Address all edits by release ID.
    gh(['api', '--method', 'PATCH', `${repo}/releases/${existing.id}`,
      '-F', 'draft=true', '-f', `tag_name=${release.tag}`, '-f', `target_commitish=${sha}`]);
    gh(['api', '--method', 'PATCH', `${repo}/git/refs/tags/${release.tag}`, '-f', `sha=${sha}`, '-F', 'force=true']);
  } else {
    gh(['release', 'create', release.tag, '--repo', release.repository, '--target', sha,
      '--title', `ChipPilot OpenAgents ${release.desktopVersion}`, '--notes-file', notes, '--draft']);
  }
  gh(['release', 'upload', release.tag, '--repo', release.repository,
    ...files.map(file => path.join(output, file)), '--clobber']);

  const uploaded = api(`releases/tags/${release.tag}`);
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(output, file));
    const asset = uploaded.assets.find(asset => asset.name === file);
    const digest = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
    if (!asset || asset.size !== bytes.length || asset.digest !== digest) {
      throw new Error(`Uploaded release asset failed verification: ${file}`);
    }
  }
  const tag = api(`git/ref/tags/${release.tag}`);
  if (tag.object.sha !== sha) throw new Error('Release tag does not point to the build commit');
  for (const asset of uploaded.assets) {
    if (!files.includes(asset.name)) gh(['api', '--method', 'DELETE', `${repo}/releases/assets/${asset.id}`]);
  }
  gh(['api', '--method', 'PATCH', `${repo}/releases/${uploaded.id}`,
    '-f', `tag_name=${release.tag}`, '-f', `target_commitish=${sha}`, '-F', 'draft=false',
    '-f', `name=ChipPilot OpenAgents ${release.desktopVersion}`, '-F', `body=@${notes}`, '-f', 'make_latest=true']);
  console.log(`Published ${release.repository} ${release.tag} from ${sha}`);
}

module.exports = { publishRelease };
