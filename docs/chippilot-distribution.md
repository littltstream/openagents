# ChipPilot distribution

This fork distributes `agn` with the sibling `packages/agent-collaboration`
package included. Official npm packages do not contain these fork additions.
Release assets are published to https://github.com/littltstream/openagents/releases.

## Install CLI

macOS / Linux:

```bash
curl -fsSL https://github.com/littltstream/openagents/releases/latest/download/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://github.com/littltstream/openagents/releases/latest/download/install.ps1 | iex
```

The installer reuses Node.js 22+ or installs a private Node runtime. It preserves
`~/.openagents` Agent configuration, credentials, pairing and working directories.
An existing CLI package is moved to `~/.openagents/backups` before replacement.
Stop a running daemon with `agn down` before installing; installation does not
automatically start all configured Agents. Reopen the terminal after first install.
`agn update` stays on this fork's release channel.

For offline installation, download `chippilot-cli.tgz` and the matching installer.
PowerShell accepts `-ArchivePath <file> -InstallRoot <directory> -NoPath`.
Bash accepts `CHIPPILOT_ARCHIVE_PATH`, `CHIPPILOT_INSTALL_ROOT`, and
`CHIPPILOT_NO_PATH=1`. Online installation verifies the tarball against `release.json`.

## Desktop server settings

Download the native Windows, macOS (Intel or Apple Silicon), or Linux installer
from the same release. These are **unsigned community builds**; the fork does
not possess the upstream publisher's signing certificates or Apple notarization.

Open **Settings → Network** before signing in. Configure:

| Field | Default |
| --- | --- |
| Workspace API | `https://api.chippilot.cn` |
| Workspace web URL | `https://openagents.chippilot.cn` |
| OIDC issuer | `https://auth.chippilot.cn/realms/openagents` |
| OIDC Client ID | `openagents-workspace` |
| Update feed | `https://github.com/littltstream/openagents/releases/latest/download` |

These values are persisted in the desktop profile's `settings.json`. Changing
server identity signs the current account out and clears its embedded Workspace
views. Sign in again against the new server. API, website and authentication
hosts may be different; the issuer includes its realm path.

Login opens the configured identity provider in the system browser, using
Authorization Code with PKCE. Configure the Keycloak client as public with
Standard Flow and S256 PKCE, allowing this exact redirect URI:

```text
http://127.0.0.1:18765/callback
```

The API must accept tokens issued by that realm for that client. The client
stores refresh tokens with its account session and never sends them to another
configured issuer or API. TLS verification remains enabled.

## Build and publish

```powershell
npm ci --prefix packages/agent-connector
node scripts/build-chippilot-cli.cjs
node scripts/prepare-chippilot-desktop.mjs
npm install --prefix packages/launcher
npm ci --prefix workspace/frontend
npm run typecheck --prefix packages/launcher
npm run build:win --prefix packages/launcher
```

The preparation command changes local build metadata and installs the tarball
from `packages/launcher/vendor`. Do not commit that generated directory or the
generated package metadata. CI performs the same preparation in a fresh checkout.

Distribution numbering starts at `.1`. For the next release, update all three
fields in `chippilot-release.json` together: `chippilot-v1.1.14.2`,
`1.1.14-chippilot.2`, and `0.2.226-chippilot.2`. Commit and push to your fork's
`develop` branch; the workflow creates the matching tag when publishing.
Normal releases retain the preceding versions. The ChipPilot
distribution workflow builds each operating system on a native runner and only
publishes when every required build succeeds. It ships the same CLI archive,
installation scripts, desktop installers, update manifests and `SHA256SUMS`.
Publishing does not require access to upstream npm or signing credentials.

When reinstalling after the development numbering reset from `.3`/`.4` to `.1`,
run the installation script again (or manually reinstall Desktop). Version
comparisons intentionally do not treat `.1` as newer than an installed `.4`.
