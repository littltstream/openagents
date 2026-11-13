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
fs.writeFileSync(notes, `ChipPilot OpenAgents ${release.desktopVersion}\n\nIncludes agent discovery, private group creation, messaging, and workspace descriptions. Desktop server/API/OIDC/update endpoints are configurable under Settings > Network. Defaults: ${release.defaultWebUrl}, ${release.defaultApiUrl}, ${release.defaultOidcIssuer}.\n\nWorkspace entry buttons and pairing links use the configured frontend, including records saved with old API addresses. API and web settings are labelled separately. Collaboration sends carry per-turn context so an adapter summary does not wake the same recipient again after a routed tool result. The matching backend update also accepts paired-device credentials for that device's own agent shared context. Update both the connector and backend to enable these collaboration fixes.\n\nNew in revision 3: agn description <name> [--set TEXT] reads, updates or clears the local default capability description without restarting running agents or overwriting existing Workspace descriptions. Desktop workspace and agent entry buttons recognize authenticated membership across old API/domain records and open the current server workspace using the account session. The develop source branch also includes the deployed Keycloak authentication, verified registration/password email flows, self-hosted invitations and server deployment configuration.\n\nDesktop installers are unsigned community builds (no upstream signing certificates or Apple notarization).\n\nCLI: download install.sh (macOS/Linux) or install.ps1 (Windows), then run it. Existing Agent configurations and workspace data are preserved.\n\nKeycloak: allow the native PKCE redirect http://127.0.0.1:18765/callback for the configured public client.\n`);
fs.appendFileSync(notes, `\nRevision 3 rebuilt from ${buildSha}: preserve native DM origins; include the verified requesting user in agent-created private teams; return canonical frontend group links; expose scoped todos through both collaboration CLI and MCP; use consistent collaboration tool instructions; prevent completed checklist updates from restarting the working indicator. Human participants retain normal thread permissions.\n`);
publishRelease({ release, sha: buildSha, output, files: [...files, 'SHA256SUMS'], notes });
