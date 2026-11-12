import http from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { authFetch } from './http'
import type { AccountSession } from './session-store'

export const OIDC_CALLBACK = 'http://127.0.0.1:18765/callback'
export interface OidcConfig { issuer: string; clientId: string; apiUrl: string }
interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string }

async function json(url: string, init?: RequestInit): Promise<Record<string, any>> {
  const response = await authFetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`OIDC ${new URL(url).pathname}: HTTP ${response.status}`)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('OIDC response must be a JSON object')
  return body as Record<string, any>
}

async function discover(config: OidcConfig): Promise<Discovery> {
  const data = await json(config.issuer + '/.well-known/openid-configuration')
  if (data.issuer !== config.issuer) throw new Error('OIDC discovery issuer does not match the configured server')
  for (const key of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint']) {
    if (typeof data[key] !== 'string') throw new Error(`OIDC discovery is missing ${key}`)
    const endpoint = new URL(data[key])
    if (endpoint.origin !== new URL(config.issuer).origin) throw new Error('OIDC endpoints must use the configured issuer origin')
  }
  return data as Discovery
}

async function sessionFrom(config: OidcConfig, discovery: Discovery, tokens: Record<string, any>): Promise<AccountSession> {
  if (typeof tokens.access_token !== 'string' || tokens.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new Error('OIDC token response is incomplete')
  }
  // UserInfo verifies the access token at its issuer; no unverified JWT claims
  // are used as account identity. The Workspace API independently verifies it.
  const user = await json(discovery.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  if (!user.sub || !user.email || user.email_verified !== true) throw new Error('A verified email address is required')
  return {
    kind: 'oidc', token: tokens.access_token, refreshToken: tokens.refresh_token,
    email: user.email, displayName: user.name || user.preferred_username || user.email,
    expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
    oidcIssuer: config.issuer, oidcSubject: user.sub, endpoint: config.apiUrl,
  }
}

export async function startOidcLogin(config: OidcConfig, openExternal: (url: string) => void) {
  const discovery = await discover(config)
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  let resolveCode!: (value: string) => void
  let rejectCode!: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  let received = false
  const server = http.createServer((request, response) => {
    const returned = new URL(request.url || '/', OIDC_CALLBACK)
    if (received || request.method !== 'GET' || returned.pathname !== '/callback' || returned.searchParams.get('state') !== state) {
      response.writeHead(400); response.end('Invalid login callback'); return
    }
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    received = true
    if (returned.searchParams.has('error') || !returned.searchParams.get('code')) {
      response.end('Login was not completed. Return to ChipPilot.')
      rejectCode(new Error('OIDC login was denied or returned no code')); return
    }
    response.end('Login received. You can return to ChipPilot.')
    resolveCode(returned.searchParams.get('code')!)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(18765, '127.0.0.1', resolve)
  })
  const timeout = setTimeout(() => rejectCode(new Error('OIDC login timed out')), 5 * 60_000)
  const close = () => { clearTimeout(timeout); server.close() }
  const authorization = new URL(discovery.authorization_endpoint)
  authorization.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: OIDC_CALLBACK,
    response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge,
    code_challenge_method: 'S256' }).toString()
  const result = code.then(async (value) => {
    const tokens = await json(discovery.token_endpoint, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId,
        redirect_uri: OIDC_CALLBACK, code: value, code_verifier: verifier }).toString() })
    return sessionFrom(config, discovery, tokens)
  }).finally(close)
  openExternal(authorization.toString())
  return { result, close: () => { rejectCode(new Error('OIDC login cancelled')); close() } }
}

export async function refreshOidcSession(config: OidcConfig, session: AccountSession): Promise<AccountSession> {
  if (!session.refreshToken || session.oidcIssuer !== config.issuer || session.endpoint !== config.apiUrl) throw new Error('OIDC session does not belong to this server')
  const discovery = await discover(config)
  const tokens = await json(discovery.token_endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, refresh_token: session.refreshToken }).toString() })
  const renewed = await sessionFrom(config, discovery, tokens)
  if (renewed.email !== session.email || renewed.oidcSubject !== session.oidcSubject) throw new Error('OIDC refresh changed the account identity')
  // OAuth permits a refresh response to omit a replacement refresh token.
  if (!renewed.refreshToken) renewed.refreshToken = session.refreshToken
  return renewed
}
