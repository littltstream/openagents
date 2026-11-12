#!/usr/bin/env bash
set -euo pipefail
release_base="${CHIPPILOT_RELEASE_BASE:-https://github.com/littltstream/openagents/releases/latest/download}"
install_root="${CHIPPILOT_INSTALL_ROOT:-$HOME/.openagents}"
archive="${CHIPPILOT_ARCHIVE_PATH:-}"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/chippilot-install.XXXXXXXX")"
node_binary="$(command -v node || true)"
if [[ -n "$node_binary" ]] && [[ "$("$node_binary" -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]]; then node_binary=''; fi
if [[ -z "$node_binary" ]]; then
  case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;; *) echo 'Use install.ps1 on Windows.' >&2; exit 1;; esac
  case "$(uname -m)" in x86_64|amd64) architecture=x64;; arm64|aarch64) architecture=arm64;; *) echo 'Unsupported CPU architecture.' >&2; exit 1;; esac
  node_version=v22.22.3
  node_archive="node-${node_version}-${platform}-${architecture}.tar.gz"
  curl --fail --show-error --location "https://nodejs.org/dist/${node_version}/${node_archive}" -o "$temporary/$node_archive"
  curl --fail --show-error --location "https://nodejs.org/dist/${node_version}/SHASUMS256.txt" -o "$temporary/node-shasums.txt"
  expected="$(awk -v name="$node_archive" '$2 == name {print $1}' "$temporary/node-shasums.txt")"
  if command -v sha256sum >/dev/null; then actual="$(sha256sum "$temporary/$node_archive" | awk '{print $1}')"; else actual="$(shasum -a 256 "$temporary/$node_archive" | awk '{print $1}')"; fi
  [[ -n "$expected" && "$expected" == "$actual" ]] || { echo 'Node.js archive checksum mismatch.' >&2; exit 1; }
  mkdir -p "$install_root/chippilot-runtime"
  tar xzf "$temporary/$node_archive" -C "$temporary"
  cp "$temporary/node-${node_version}-${platform}-${architecture}/bin/node" "$install_root/chippilot-runtime/node"
  node_binary="$install_root/chippilot-runtime/node"
fi
if [[ -z "$archive" ]]; then
  curl --fail --show-error --location "$release_base/release.json" -o "$temporary/release.json"
  asset="$("$node_binary" -p 'require(process.argv[1]).cliAsset' "$temporary/release.json")"
  expected="$("$node_binary" -p 'require(process.argv[1]).sha256' "$temporary/release.json")"
  archive="$temporary/chippilot-cli.tgz"
  curl --fail --show-error --location "$release_base/$asset" -o "$archive"
  actual="$("$node_binary" -e 'const fs=require("fs"),c=require("crypto"); process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$archive")"
  [[ "$expected" == "$actual" ]] || { echo 'CLI archive checksum mismatch.' >&2; exit 1; }
fi
tar xzf "$archive" -C "$temporary"
"$node_binary" "$temporary/package/installers/install.cjs" "$install_root" "$archive"
command_dir="$install_root/nodejs/node_modules/.bin"
if [[ "${CHIPPILOT_NO_PATH:-0}" != 1 ]]; then
  profile="$HOME/.profile"
  [[ "${SHELL:-}" == */zsh ]] && profile="$HOME/.zshrc"
  export_line="export PATH=\"$command_dir:\$PATH\""
  if [[ ! -f "$profile" ]] || ! grep -Fq "$export_line" "$profile"; then printf '\n%s\n' "$export_line" >> "$profile"; fi
fi
printf 'Ready. Open a new terminal and run: agn version\n'
