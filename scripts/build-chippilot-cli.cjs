'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const release = require('../chippilot-release.json');
const output = path.resolve(process.argv[2] || path.join(root, 'artifacts/chippilot'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chippilot-pack-'));
const pkg = path.join(temp, 'package');
const connector = path.join(root, 'packages/agent-connector');
const collaboration = path.join(root, 'packages/agent-collaboration');
fs.mkdirSync(pkg);
for (const entry of ['src', 'bin', 'icons', 'registry.json', 'README.md', 'package.json']) {
  fs.cpSync(path.join(connector, entry), path.join(pkg, entry), { recursive: true });
}
const vendor = path.join(pkg, 'vendor/agent-collaboration');
for (const entry of ['src', 'bin', 'skills', 'package.json', 'README.md']) {
  fs.mkdirSync(vendor, { recursive: true });
  fs.cpSync(path.join(collaboration, entry), path.join(vendor, entry), { recursive: true });
}
function visit(dir, transform) {
  for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, file.name);
    if (file.isDirectory()) visit(target, transform);
    else if (file.name.endsWith('.js')) {
      const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
      fs.writeFileSync(target, transform(source, target));
    }
  }
}
visit(path.join(pkg, 'src'), (text, file) => text.replaceAll('https://workspace-endpoint.openagents.org', release.defaultApiUrl).replaceAll('https://workspace.openagents.org', release.defaultWebUrl).replace(
  /require\((['"])(\.\.\/(?:\.\.\/)*agent-collaboration\/[^'"]+)\1\)/g,
  (_match, _quote, request) => {
    const suffix = request.slice(request.indexOf('agent-collaboration/') + 'agent-collaboration/'.length);
    let relative = path.relative(path.dirname(file), path.join(vendor, suffix)).replace(/\\/g, '/');
    if (!relative.startsWith('.')) relative = './' + relative;
    return `require('${relative}')`;
  },
));
const cli = path.join(vendor, 'bin/collaboration.js');
let cliText = fs.readFileSync(cli, 'utf8');
if (!cliText.includes("../../agent-connector/src/workspace-client")) throw new Error('Collaboration transport import changed');
fs.writeFileSync(cli, cliText.replace('../../agent-connector/src/workspace-client', '../../../src/workspace-client'));
const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
manifest.version = release.cliVersion;
manifest.chippilot = release;
manifest.files.push('vendor/', 'installers/');
manifest.bundleDependencies = ['ws', 'blessed'];
delete manifest.scripts;
fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const dependency of manifest.bundleDependencies) {
  const depRoot = path.dirname(require.resolve(`${dependency}/package.json`, { paths: [connector] }));
  fs.mkdirSync(path.join(pkg, 'node_modules'), { recursive: true });
  fs.cpSync(depRoot, path.join(pkg, 'node_modules', dependency), { recursive: true });
}
fs.mkdirSync(path.join(pkg, 'installers'));
for (const file of ['install.sh', 'install.ps1']) fs.copyFileSync(path.join(root, file), path.join(pkg, 'installers', file));
fs.copyFileSync(path.join(root, 'scripts/install-chippilot.cjs'), path.join(pkg, 'installers/install.cjs'));
const archive = path.join(output, 'chippilot-cli.tgz');
// This is an ordinary npm-compatible package tarball. Calling tar directly
// avoids cmd.exe reparsing package paths with spaces on Windows.
execFileSync('tar', ['-czf', archive, '-C', temp, 'package'], { windowsHide: true });
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify({ ...release, cliAsset: 'chippilot-cli.tgz', sha256 }, null, 2) + '\n');
for (const file of ['install.sh', 'install.ps1']) fs.copyFileSync(path.join(root, file), path.join(output, file));
process.stdout.write(JSON.stringify({ archive, sha256, version: manifest.version }) + '\n');
