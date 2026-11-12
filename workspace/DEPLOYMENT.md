## Current public entry points (2026-11-11)

| Service | URL |
| --- | --- |
| Workspace home | https://openagents.chippilot.cn/ |
| Chip test workspace | https://openagents.chippilot.cn/2f7dc113 |
| API | https://api.chippilot.cn |
| Keycloak administration | https://auth.chippilot.cn/admin/ |
| Account settings | https://auth.chippilot.cn/realms/openagents/account/ |

The three service A records point to 101.43.200.65 with TTL 600. The apex domain was not changed.
Canonical application URLs, Keycloak issuer/callbacks, API CORS and the compiled frontend use .cn.
Users should sign in again on the new domain. Existing IP transport ports remain open;
application sign-in uses the canonical domain. /new and its descendants remain 404.

Configuration snapshot: /home/weizhiyi/openagents-backups/cn-activation-20261111-161507
Database dumps: /home/weizhiyi/openagents-backups/cn-cutover-data-20261111-161506
Verification report: /home/weizhiyi/openagents-runtime/cn-deployment-report.json
Both database container IDs and their volume mounts were verified unchanged (25 workspaces, 7 accounts).
The existing .cn certificate renewal job remains enabled at 03:32 Asia/Shanghai daily.

# Production deployment

Canonical source: `/home/weizhiyi/openagents` (feature/auth).
Runtime settings: `/home/weizhiyi/openagents-runtime`.
Backups and retired deployments: `/home/weizhiyi/openagents-backups`.

## Commands

```sh
cd /home/weizhiyi/openagents/workspace
./compose.sh up -d --no-build
./compose.sh ps
./compose.sh logs --tail 100
```

For frontend source changes, build with `./compose.sh build frontend` before recreating it. NEXT_PUBLIC settings are embedded at build time. After recreating an upstream service, reload both Nginx proxies:

```sh
docker exec openagents-proxy nginx -s reload
docker exec openagents-domain-proxy nginx -s reload
```

## Services

| Container | Public entry |
| --- | --- |
| openagents-frontend | Via Nginx, https://101.43.200.65:3000/ |
| openagents-backend | Via Nginx, https://101.43.200.65:8000 |
| openagents-keycloak | Via Nginx, https://101.43.200.65:9443/admin/ |
| openagents-db | 127.0.0.1:5432 |
| openagents-keycloak-db | Private Docker network |
| openagents-proxy | 3000 / 8000 / 9443 |
| openagents-domain-proxy | 443 |

The direct host mappings 3100/8100/8180 remain disabled.

The existing external data volumes keep their original names: openagents-auth_pgdata, openagents-auth_keycloak_pgdata, openagents-auth_workspace_files. Their contents were not migrated. Do not delete these volumes. The backend entrypoint runs Uvicorn directly; this deployment does not automatically run database migrations.

The separate Python SDK network service remains enabled as openagents-network.service. Its runtime directory is /home/weizhiyi/openagents-runtime/network and its source is this repository's sdk directory.

Private workspace environment settings and SMTP credentials are outside the repository. IP HTTPS uses the public Let's Encrypt certificate described below.

The retired /new, /new/ and /new/* frontend entry paths return HTTP 404 on both IP and domain frontend endpoints.

## Registration password form (Keycloak 26.8.1)

The required registration-password-action execution has always_set_password_on_register_form=true. Users choose and confirm their password on the registration page, then verify their email before entering Workspace. verifyEmail=true and the existing minimum-eight-character password policy remain enabled. keycloak/configure_auth.py applies and verifies this execution configuration whenever --enable-registration is used. No theme override or image rebuild is required. Verification results are recorded in /home/weizhiyi/openagents-runtime/registration-fix-report.json.

## chippilot.cn deployment (activated 2026-11-11)

The .cn configuration was activated on 2026-11-11 after ICP approval and DNS publication.
The canonical compose.sh includes compose.cn.yml; use compose.sh for future production operations.
Existing accounts, workspaces and external database/file volumes were retained.
Frontend: https://openagents.chippilot.cn
API: https://api.chippilot.cn
Keycloak: https://auth.chippilot.cn (admin: /admin/, account: /realms/openagents/account/).

Prepared files:
- compose.cn.yml: target URLs, CORS, frontend image and proxy mount overrides.
- compose-cn.sh: configuration/build entry point for the same openagents Compose project.
- /home/weizhiyi/openagents-runtime/domain-nginx-cn.conf and port-nginx-cn.conf: target routes.
- /home/weizhiyi/openagents-runtime/cn-keycloak-config.py: prepares callbacks; issuer unchanged.
- /home/weizhiyi/openagents-runtime/switch-cn-domain.py: guarded activation and rollback.
- /home/weizhiyi/openagents-runtime/cn-preparation-report.json: verification evidence.
- openagents-frontend:chippilot-cn: built and verified image.

Original database/storage volumes are unchanged. Activation recreates only frontend, backend,
Keycloak application and two proxies, without recreating database containers or running migrations.

Before DNS is ready, do not run compose-cn.sh up. Build/config commands:
```sh
cd /home/weizhiyi/openagents/workspace
./compose-cn.sh config --quiet
./compose-cn.sh build frontend
```

After ICP approval and publishing all three A records to 101.43.200.65:
```sh
python3 /home/weizhiyi/openagents-runtime/switch-cn-domain.py check
python3 /home/weizhiyi/openagents-runtime/switch-cn-domain.py activate
```

The check rejects missing/unexpected A records. For an intentional gateway, pass --expected-ip
with its address and first configure that gateway's proxy and TLS.

Activation saves a fresh private snapshot, sets canonical URLs, updates Keycloak callbacks,
and makes compose.sh include compose.cn.yml for subsequent operations. It checks frontend/API
health and the exact public issuer. Users sign in again; verify real login and pairing afterwards.

On failure the script returns an error and prints the rollback command. Use the activation
snapshot path, not the preparation snapshot:
```sh
python3 /home/weizhiyi/openagents-runtime/switch-cn-domain.py rollback --snapshot /home/weizhiyi/openagents-backups/cn-activation-TIMESTAMP
```

Verified before DNS publication: Nginx syntax, target Compose, compiled API/auth URLs, trusted
HTTPS routing using temporary DNS overrides, 20 frontend assets, backend/database readiness,
new callback acceptance, retired /new routes and the DNS gate. Test containers were removed.
The production issuer is now https://auth.chippilot.cn/realms/openagents.
Local browser checks passed using ordinary DNS and normal public CA verification: homepage,
login redirect, login fields and registration password fields. API readiness and CORS passed.
A complete human-account login and a new device-pairing flow have not been tested after cutover.

## Publicly trusted IP certificate

All three IP HTTPS entries (3000 frontend, 8000 API, 9443 Keycloak) use the
Let's Encrypt shortlived certificate for 101.43.200.65. Domain certificates remain separate.
Active and prepared .cn port-proxy configurations both reference port-tls/ip.fullchain.pem
and port-tls/ip.key. Old server.crt/server.key are retained only for recovery.

Private state: /home/weizhiyi/openagents-runtime/acme-ip (mode 700).
Installed files: /home/weizhiyi/openagents-runtime/port-tls/ip.{cert.pem,ca.pem,fullchain.pem,key}.
Renewal: /home/weizhiyi/openagents-runtime/renew-ip-certificate.sh.
Verification: /home/weizhiyi/openagents-runtime/verify-ip-certificate.py.
Log: /home/weizhiyi/openagents-runtime/ip-certificate-renew.log.
Cron: minute 47 every four hours, Asia/Shanghai; renew when <=72 hours remain.

IP validation uses TLS-ALPN-01 on 443. Only when renewal is needed, the script temporarily
stops domain-proxy, validates/signs, installs the new certificate and reloads port-proxy,
then restores domain-proxy with an EXIT trap even on failure. Domain HTTPS 443 has a brief
interruption for this operation; 3000/8000/9443 and database containers stay running.
Host Nginx on port 80 is unchanged because it belongs to the OpenClaw redirect.

The public CA chain, IP SAN, private-key match, served certificate on all three ports,
frontend/API/Keycloak health, local Node.js strict TLS and browser default TLS were verified.
The renewal command's not-due path was run successfully; an additional forced renewal
was not performed. A deployed-certificate marker is written only after strict verification.
Failed deployments retain the old marker so the next check retries loading the new certificate.

cn-keycloak-config.py and switch-cn-domain.py now use system CA trust. Do not pass the
old self-signed server.crt as the CA bundle for these public IP entries. Clients no longer
need NODE_TLS_REJECT_UNAUTHORIZED=0. Existing processes must restart to pick up environment changes.
