# 自托管 Keycloak 登录

本功能为 Web Workspace 增加可选的 `AUTH_MODE=oidc`，使用 Keycloak 的公开客户端、
Authorization Code + PKCE S256。密码、GitHub 绑定和 MFA 在 Keycloak 管理；
Workspace 成员关系、设备配对和资源权限仍在 OpenAgents 管理。
现有 Firebase 和 Workspace token 模式保持兼容。桌面 Launcher 的账号登录未改造；
本机 Agent 仍可以通过 `agn connect ... --endpoint ...` 连接。

## 部署

需要 Docker Compose >=2.24.4。先配置三个可访问的 HTTPS origin（也可以通过同源
反向代理提供 API），例如 `workspace.example.com`、`api.example.com` 和
`auth.example.com`。Keycloak 的 8080 端口仅绑定主机回环地址，反向代理应转发到
`127.0.0.1:8080` 并正确覆盖 `X-Forwarded-*`，不能接受来自公网客户端的伪造代理头。
本地验证可分别使用 `http://localhost:3000`、`:8000`、`:8080`；公网裸 HTTP IP
不满足浏览器 PKCE 所需的安全上下文。TLS、DNS、SMTP 和防火墙由部署者配置。

```bash
cd workspace
cp keycloak/auth.env.example .env.auth
# 编辑 .env.auth，填写 origin 和独立随机密码；不要提交该文件。
docker compose --env-file .env.auth -f docker-compose.yml -f docker-compose.keycloak.yml config --quiet
docker compose --env-file .env.auth -f docker-compose.yml -f docker-compose.keycloak.yml up -d keycloak-db keycloak
```

Keycloak 使用独立的 PostgreSQL 服务和持久卷，不共用 Workspace 数据库账号。
首次启动导入 `keycloak/openagents-realm.json`，创建 `openagents` realm 和
`openagents-workspace` client；默认不开放自助注册，不导入任何用户或密码。
已有 realm 不会被重启时自动覆盖，后续改配置应使用管理后台。

### Workspace 数据库迁移

新增迁移 `086` 只创建 `user_identities` 表，不删除或回填已有数据。部署到现有服务前，
先备份 Workspace 数据库，停止写入者，并检查 `alembic current`；部署者明确批准后再执行：

```bash
docker compose --env-file .env.auth -f docker-compose.yml -f docker-compose.keycloak.yml build backend frontend
docker compose --env-file .env.auth -f docker-compose.yml -f docker-compose.keycloak.yml run --rm --no-deps backend alembic upgrade head
docker compose --env-file .env.auth -f docker-compose.yml -f docker-compose.keycloak.yml up -d backend frontend
```

`upgrade head` 会执行数据库当前版本之后的所有迁移，不只是 086；若落后很多版本，
先审核中间迁移。本功能的代码拉取不等于已经执行迁移或切换认证。
前端构建时写入配置；仅重启容器不会更换登录提供方。overlay 移除旧前端绑定和
匿名 `.next` 卷，确保提供当前镜像中的构建。

## 账号管理

访问 Keycloak 管理后台，使用 `.env.auth` 中的初始管理员登录。在 `openagents` realm
的 Users 中创建用户，填写真实邮箱、设置初始密码，可要求首次登录修改密码。
配置 SMTP 后让用户验证邮箱；若由管理员线下核实，可显式设置 Email verified。
未验证邮箱会被 Workspace 拒绝。账号密码从不经过 Workspace 后端。

登录 Workspace 后创建工作空间，创建者会成为 owner。匿名 CLI 先前创建的工作空间
不会自动归新账号所有；通过现有邀请/成员管理流程明确授权。登录本身不授予其他
Workspace 的权限。以已授权成员身份访问“连接设备”即可创建配对码。

Keycloak 的 Identity Providers -> GitHub 可配置你自己的 GitHub OAuth 应用；用户
通过 Keycloak Account Console 将 GitHub 绑定到同一账号。不要开启按未验证邮箱
自动合并账号。短信登录需额外认证扩展及短信网关，本实现没有添加。

## 身份与安全边界

- 后端只接受所配置 issuer、client audience 和 azp 签发的 RS256 access token，
  验证签名、有效期和 verified email；OIDC 模式不接受 Firebase、Apple 或旧的
  Workspace 人类会话 JWT。机器的 Workspace/node token 验证不受影响。
- 首次以 verified email 关联邀请或旧用户；之后使用 `(issuer, sub)` 稳定绑定。
  同一 issuer 的另一 subject 不能接管已绑定账号。
- 为兼容当前以邮箱保存的 ACL，首次绑定后的 Workspace 邮箱保持不变。Keycloak
  修改邮箱不会静默转移现有权限；如需更改 Workspace 邮箱，要单独审核相关 ACL。
- 客户端只在内存中保存 access/refresh token；使用官方 keycloak-js 刷新和退出会话。
  已签发 access token 在到期前仍可能有效，禁用用户不是即刻吊销全部 JWT。
- `OIDC_JWKS_URL` 可指向内网 Keycloak；`OIDC_ISSUER_URL` 必须保持为浏览器所用的
  公网 issuer，不能用内网地址替换。此配置文件和 realm 不包含任何真实密钥。
- 若本机或容器启用了 HTTP 代理，需在后端的 `NO_PROXY` 中包含 `keycloak`、
  `localhost`、`127.0.0.1`，让内网公钥请求直接连接。不要为此修改系统全局代理。

## 验证

1. `.../realms/openagents/.well-known/openid-configuration` 能公开访问。
2. Workspace 登录页跳到自己的 Keycloak，不访问官方 OpenAgents 登录站点。
3. 登录、刷新页面、会话续期和退出都成功；未登录访问成员 API 应被拒绝。
4. 已授权用户可以生成配对码，另一未授权用户不能访问私有 Workspace。
5. `agn connect <agent> <token> --endpoint <api-origin>` 后 Agent 正常收发消息。

官方参考：
- https://www.keycloak.org/securing-apps/javascript-adapter
- https://www.keycloak.org/securing-apps/oidc-layers
- https://www.keycloak.org/server/containers
