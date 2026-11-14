'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { publishRelease } = require('./publish-chippilot-release.cjs');
const yaml = require('js-yaml');
const release = require('../chippilot-release.json');
const buildSha = process.argv[3] || process.env.GITHUB_SHA;
if (process.env.GITHUB_REPOSITORY !== release.repository) throw new Error('Publish only to the configured fork');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== release.tag) throw new Error('Tag does not match release manifest');
const input = path.resolve(process.argv[2]);
const output = path.resolve('artifacts/publish');
fs.mkdirSync(output, { recursive: true });
const mac = [];
for (const directory of fs.readdirSync(input)) {
  for (const file of fs.readdirSync(path.join(input, directory))) {
    const source = path.join(input, directory, file);
    if (!fs.statSync(source).isFile()) continue;
    if (file === 'latest-mac.yml') { mac.push(yaml.load(fs.readFileSync(source, 'utf8'))); continue; }
    const destination = path.join(output, file);
    if (fs.existsSync(destination) && !fs.readFileSync(destination).equals(fs.readFileSync(source))) throw new Error(`Conflicting release asset: ${file}`);
    fs.copyFileSync(source, destination);
  }
}
if (mac.length !== 2 || mac.some(m => m.version !== release.desktopVersion)) throw new Error('Both macOS update manifests are required');
const merged = { ...mac[0], files: mac.flatMap(m => m.files) };
fs.writeFileSync(path.join(output, 'latest-mac.yml'), yaml.dump(merged));
const files = fs.readdirSync(output);
for (const extension of ['.exe', '.dmg', '.AppImage', '.deb']) {
  if (!files.some(f => f.endsWith(extension))) throw new Error(`Missing native build: ${extension}`);
}
for (const name of ['install.sh', 'install.ps1', 'release.json', 'chippilot-cli.tgz', 'latest.yml', 'latest-linux.yml']) {
  if (!files.includes(name)) throw new Error(`Missing release asset: ${name}`);
}
const sums = files.map(file => crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex') + '  ' + file).join('\n') + '\n';
fs.writeFileSync(path.join(output, 'SHA256SUMS'), sums);
const notes = path.join(output, 'release-notes.md');
fs.writeFileSync(notes, `ChipPilot OpenAgents ${release.desktopVersion}

Revision 4 adds shared work briefs to the collaboration CLI and MCP tools:
- CLI: get-brief and update-brief; MCP: workspace_get_brief and workspace_update_brief.
- Both interfaces share validation, caller identity, channel checks and partial-update behavior. Agents use these tools instead of raw HTTP; native DMs have no shared brief.
- The matching backend lets authenticated agent members edit their group's brief, checks private-thread visibility and rejects a forged source identity. Update the backend as well as the connector for this fix.

Includes the existing discovery, agent-created private teams, user-visible collaboration links, scoped todos, return-to-origin messaging, local default descriptions and configurable Desktop API/web/OIDC endpoints. Human participants retain normal thread permissions.

Defaults: ${release.defaultWebUrl}, ${release.defaultApiUrl}, ${release.defaultOidcIssuer}.

Desktop installers are unsigned community builds (no upstream signing certificates or Apple notarization).

CLI: download install.sh (macOS/Linux) or install.ps1 (Windows), then run it. Existing Agent configurations and workspace data are preserved. Existing ChipPilot CLI installations can use agn update.

Keycloak: allow the native PKCE redirect http://127.0.0.1:18765/callback for the configured public client.

Built from ${buildSha}.
`);
publishRelease({ release, sha: buildSha, output, files: [...files, 'SHA256SUMS'], notes });
