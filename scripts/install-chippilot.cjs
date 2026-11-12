'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const [rootArg, archive] = process.argv.slice(2);
if (!rootArg || !archive) throw new Error('Installation root and archive are required');
const installRoot = path.resolve(rootArg);
if (installRoot === path.parse(installRoot).root || installRoot === os.homedir()) throw new Error('Use an application directory as the install root');
const pidFile = path.join(installRoot, 'daemon.pid');
if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid daemon PID file; inspect it before installing');
  try {
    process.kill(pid, 0);
    throw new Error('The Agent daemon is running. Run agn down before installing this release.');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
const source = path.resolve(__dirname, '..');
const manifest = require(path.join(source, 'package.json'));
if (!manifest.chippilot || !manifest.version.includes('chippilot')) throw new Error('This archive is not a ChipPilot collaboration release');
const tools = require(path.join(source, 'vendor/agent-collaboration/src')).defs.map((tool) => tool.name);
if (!tools.includes('workspace_create_group')) throw new Error('Collaboration tools are missing');
const target = path.join(installRoot, 'nodejs/node_modules/@openagents-org/agent-launcher');
const stage = target + `.install-${process.pid}`;
if (fs.existsSync(stage)) throw new Error('Installation staging directory already exists');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, stage, { recursive: true });
const check = spawnSync(process.execPath, [path.join(stage, 'bin/agent-connector.js'), 'version'], {
  encoding: 'utf8', env: { ...process.env, OPENAGENTS_SKIP_UPDATE_CHECK: '1' }, windowsHide: true,
});
if (check.status !== 0) throw new Error(`New CLI failed validation: ${check.stderr}`);
const backup = path.join(installRoot, 'backups', `agn-${Date.now()}`);
if (fs.lstatSync(target, { throwIfNoEntry: false })) {
  fs.mkdirSync(backup, { recursive: true });
  // rename moves an existing junction itself; it never recursively deletes its target.
  fs.renameSync(target, path.join(backup, 'agent-launcher'));
}
fs.renameSync(stage, target);
const bin = path.join(installRoot, 'nodejs/node_modules/.bin');
fs.mkdirSync(bin, { recursive: true });
const entry = path.join(target, 'bin/agent-connector.js');
for (const name of ['agn', 'openagents', 'agent-connector']) {
  const destinations = process.platform === 'win32' ? [`${name}.cmd`, `${name}.ps1`, name] : [name];
  for (const file of destinations) {
    const dest = path.join(bin, file);
    const stat = fs.lstatSync(dest, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) fs.unlinkSync(dest);
  }
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "${entry}" %*\r\n`);
    const ps = (value) => "'" + value.replace(/'/g, "''") + "'";
    fs.writeFileSync(path.join(bin, `${name}.ps1`), `& ${ps(process.execPath)} ${ps(entry)} @args\nexit $LASTEXITCODE\n`);
  }
  const quote = (value) => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`, { mode: 0o755 });
}
const savedArchive = path.join(installRoot, 'downloads', `chippilot-cli-${manifest.version}.tgz`);
fs.mkdirSync(path.dirname(savedArchive), { recursive: true });
fs.copyFileSync(archive, savedArchive);
const prefixManifest = path.join(installRoot, 'nodejs/package.json');
const prefix = fs.existsSync(prefixManifest) ? JSON.parse(fs.readFileSync(prefixManifest, 'utf8')) : { private: true, dependencies: {} };
prefix.dependencies = { ...prefix.dependencies, '@openagents-org/agent-launcher': `file:${savedArchive.replace(/\\/g, '/')}` };
fs.writeFileSync(prefixManifest, JSON.stringify(prefix, null, 2) + '\n');
console.log(`Installed agn ${manifest.version}; collaboration tools: ${tools.length}`);
console.log(`Command directory: ${bin}`);
