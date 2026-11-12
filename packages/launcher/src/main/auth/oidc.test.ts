// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { startOidcLogin, refreshOidcSession, OIDC_CALLBACK } from './oidc'
vi.mock('./http', () => ({ authFetch: vi.fn() }))
import { authFetch } from './http'
const config = { issuer: 'https://auth.example.com/realms/team', clientId: 'desktop', apiUrl: 'https://api.example.com' }
const discovery = { issuer: config.issuer, authorization_endpoint: config.issuer+'/authorize', token_endpoint: config.issuer+'/token', userinfo_endpoint: config.issuer+'/userinfo' }
afterEach(() => vi.resetAllMocks())

it('exchanges a loopback code using state + PKCE and binds the session to this server', async () => {
  let verifier = ''
  vi.mocked(authFetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('openid-configuration')) return Response.json(discovery)
    if (String(url).endsWith('/token')) {
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('redirect_uri')).toBe(OIDC_CALLBACK)
      expect(form.get('code')).toBe('test-code')
      verifier = form.get('code_verifier')!
      return Response.json({ access_token: 'test-access', token_type: 'Bearer', expires_in: 300, refresh_token: 'test-refresh' })
    }
    expect(init?.headers).toEqual({ Authorization: 'Bearer test-access' })
    return Response.json({ sub: 'user-1', email: 'test@example.com', email_verified: true })
  })
  let opened = ''
  const login = await startOidcLogin(config, url => { opened = url })
  try {
    const authorization = new URL(opened)
    const state = authorization.searchParams.get('state')!
    const wrong = await fetch(`${OIDC_CALLBACK}?state=wrong&code=x`)
    expect(wrong.status).toBe(400)
    expect(vi.mocked(authFetch)).toHaveBeenCalledTimes(1)
    await fetch(`${OIDC_CALLBACK}?state=${state}&code=test-code`)
    const session = await login.result
    expect(session).toMatchObject({ kind: 'oidc', endpoint: config.apiUrl, oidcIssuer: config.issuer, oidcSubject: 'user-1', email: 'test@example.com' })
    expect(authorization.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'))
  } finally { login.close() }
})

it('rejects a discovery endpoint on another host before opening a browser', async () => {
  vi.mocked(authFetch).mockResolvedValue(Response.json({ ...discovery, token_endpoint: 'https://foreign.example.com/token' }))
  const open = vi.fn()
  await expect(startOidcLogin(config, open)).rejects.toThrow('issuer origin')
  expect(open).not.toHaveBeenCalled()
})

it('never sends a stored refresh token to a different server', async () => {
  await expect(refreshOidcSession(config, { kind: 'oidc', token: 'access', refreshToken: 'private', endpoint: 'https://other.example.com', oidcIssuer: config.issuer, email: 'x@example.com', displayName: null, expiresAt: 1 })).rejects.toThrow('does not belong')
  expect(authFetch).not.toHaveBeenCalled()
})
