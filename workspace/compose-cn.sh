#!/bin/sh
set -eu
cd /home/weizhiyi/openagents/workspace
exec docker compose -p openagents --env-file /home/weizhiyi/openagents-runtime/workspace.env -f docker-compose.yml -f docker-compose.keycloak.yml -f compose.server.yml -f compose.cn.yml "$@"
