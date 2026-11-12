'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const release = require('../chippilot-release.json');
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
fs.writeFileSync(notes, `ChipPilot OpenAgents ${release.desktopVersion}\n\nIncludes agent discovery, private group creation, messaging, and workspace descriptions. Desktop server/API/OIDC/update endpoints are configurable under Settings > Network. Defaults: ${release.defaultWebUrl}, ${release.defaultApiUrl}, ${release.defaultOidcIssuer}.\n\nDesktop installers are unsigned community builds (no upstream signing certificates or Apple notarization).\n\nCLI: download install.sh (macOS/Linux) or install.ps1 (Windows), then run it. Existing Agent configurations and workspace data are preserved.\n\nKeycloak: allow the native PKCE redirect http://127.0.0.1:18765/callback for the configured public client.\n`);
if (process.env.CHIPPILOT_RESET_RELEASE_SERIES === '2026-11-12') {
  execFileSync(process.execPath, [path.join(__dirname, 'reset-chippilot-release-series.cjs')], { stdio: 'inherit' });
}
execFileSync('gh', ['release', 'create', release.tag, '--repo', release.repository, '--target', process.env.GITHUB_SHA, '--title', `ChipPilot OpenAgents ${release.desktopVersion}`, '--notes-file', notes, '--draft'], { stdio: 'inherit' });
execFileSync('gh', ['release', 'upload', release.tag, '--repo', release.repository, ...[...files, 'SHA256SUMS'].map(f => path.join(output, f))], { stdio: 'inherit' });
execFileSync('gh', ['release', 'edit', release.tag, '--repo', release.repository, '--draft=false', '--latest'], { stdio: 'inherit' });
