import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = JSON.parse(fs.readFileSync(path.join(root, 'chippilot-release.json')))
const launcher = path.join(root, 'packages/launcher')
const archive = path.resolve(process.argv[2] || 'artifacts/chippilot/chippilot-cli.tgz')
if (!fs.existsSync(archive)) throw new Error('Build the collaboration CLI archive first')
fs.mkdirSync(path.join(launcher, 'vendor'), { recursive: true })
fs.copyFileSync(archive, path.join(launcher, 'vendor/chippilot-cli.tgz'))
const file = path.join(launcher, 'package.json')
const pkg = JSON.parse(fs.readFileSync(file))
pkg.version = release.desktopVersion
pkg.homepage = `https://github.com/${release.repository}`
pkg.repository.url = `${pkg.homepage}.git`
pkg.dependencies['@openagents-org/agent-launcher'] = 'file:vendor/chippilot-cli.tgz'
pkg.build.appId = 'icu.chippilot.openagents'
pkg.build.productName = 'ChipPilot OpenAgents'
pkg.build.mac.identity = null
pkg.build.mac.notarize = false
pkg.build.detectUpdateChannel = false
pkg.build.generateUpdatesFilesForAllChannels = true
pkg.build.publish = { provider: 'generic', url: `https://github.com/${release.repository}/releases/latest/download`, channel: 'latest', useMultipleRangeRequest: false }
// Our unsigned release does not use the upstream publisher's certificates.
delete pkg.build.afterSign
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
console.log(`Prepared ${pkg.build.productName} ${pkg.version} with the bundled collaboration core`)
