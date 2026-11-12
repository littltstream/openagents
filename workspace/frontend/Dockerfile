FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=https://api.chippilot.icu
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ARG NEXT_PUBLIC_OPENAGENTS_API_URL=
ENV NEXT_PUBLIC_OPENAGENTS_API_URL=${NEXT_PUBLIC_OPENAGENTS_API_URL}
# Self-hosted / preview deployments on their own domain (see
# lib/openagents-auth-context.tsx and lib/auth-redirects.ts).
ARG NEXT_PUBLIC_FIRST_PARTY_HOSTNAMES=openagents.chippilot.icu
ENV NEXT_PUBLIC_FIRST_PARTY_HOSTNAMES=${NEXT_PUBLIC_FIRST_PARTY_HOSTNAMES}
ARG NEXT_PUBLIC_INLINE_LOGIN=
ENV NEXT_PUBLIC_INLINE_LOGIN=${NEXT_PUBLIC_INLINE_LOGIN}
ARG NEXT_PUBLIC_AUTH_MODE=
ARG NEXT_PUBLIC_OIDC_REGISTRATION_ENABLED=0
ENV NEXT_PUBLIC_OIDC_REGISTRATION_ENABLED=${NEXT_PUBLIC_OIDC_REGISTRATION_ENABLED}
ARG NEXT_PUBLIC_KEYCLOAK_URL=
ARG NEXT_PUBLIC_KEYCLOAK_REALM=
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=
ENV NEXT_PUBLIC_AUTH_MODE=${NEXT_PUBLIC_AUTH_MODE} \
    NEXT_PUBLIC_KEYCLOAK_URL=${NEXT_PUBLIC_KEYCLOAK_URL} \
    NEXT_PUBLIC_KEYCLOAK_REALM=${NEXT_PUBLIC_KEYCLOAK_REALM} \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=${NEXT_PUBLIC_KEYCLOAK_CLIENT_ID}

# Install dependencies
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com

# Copy application code
COPY frontend/. .
# Source tests import these public model registries during Next's type check.
COPY backend/registry /backend/registry

# Build
RUN npm run build

# Serve the built standalone bundle without build dependencies.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
