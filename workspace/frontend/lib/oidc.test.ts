import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), client: {
  init: vi.fn(), updateToken: vi.fn(), login: vi.fn(), logout: vi.fn(), register: vi.fn(),
  authenticated: true, token: 'access-token',
  tokenParsed: { email: 'owner@example.test', email_verified: true, name: 'Owner' },
} }));
vi.mock('keycloak-js', () => ({ default: class { constructor() { return mocks.client; } } }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_URL', 'https://auth.example.test');
  vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_REALM', 'openagents');
  vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_CLIENT_ID', 'openagents-workspace');
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, data: { emailSent: true } }) });
  vi.stubGlobal('window', { location: { origin: 'https://workspace.example.test', href: 'https://workspace.example.test/invite/abc' } });
  mocks.client.authenticated = true;
  mocks.client.tokenParsed.email_verified = true;
  mocks.client.init.mockResolvedValue(true);
  mocks.client.updateToken.mockResolvedValue(false);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('initializes once with code flow PKCE and no login iframe', async () => {
  const { getOidcClient } = await import('./oidc');
  await Promise.all([getOidcClient(), getOidcClient()]);
  expect(mocks.client.init).toHaveBeenCalledOnce();
  expect(mocks.client.init).toHaveBeenCalledWith(expect.objectContaining({ pkceMethod: 'S256', checkLoginIframe: false }));
});
it('refreshes the access token and keeps refresh tokens out of the app session', async () => {
  const { getOidcIdentity } = await import('./oidc');
  expect(await getOidcIdentity(true)).toEqual({ token: 'access-token', user: { email: 'owner@example.test', displayName: 'Owner', photoURL: null } });
  expect(mocks.client.updateToken).toHaveBeenCalledWith(-1);
});
it('returns no identity when signed out and rejects unverified email', async () => {
  const { getOidcIdentity } = await import('./oidc');
  mocks.client.authenticated = false;
  expect(await getOidcIdentity()).toBeNull();
  mocks.client.authenticated = true; mocks.client.tokenParsed.email_verified = false;
  await expect(getOidcIdentity()).rejects.toThrow('verified email');
});
it('propagates refresh failure instead of restoring an old identity', async () => {
  const { getOidcIdentity } = await import('./oidc');
  mocks.client.updateToken.mockRejectedValueOnce(new Error('session expired'));
  await expect(getOidcIdentity()).rejects.toThrow('session expired');
});
it('preserves the invitation on login and returns to local login on logout', async () => {
  const { signInWithOidc, signOutWithOidc } = await import('./oidc');
  await signInWithOidc();
  expect(mocks.client.login).toHaveBeenCalledWith(expect.objectContaining({ redirectUri: window.location.href }));
  await signOutWithOidc();
  expect(mocks.client.logout).toHaveBeenCalledWith({ redirectUri: 'https://workspace.example.test/login' });
});
it('rejects incomplete configuration', async () => {
  vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_REALM', '');
  const { getOidcClient } = await import('./oidc');
  await expect(getOidcClient()).rejects.toThrow('required');
  expect(mocks.client.init).not.toHaveBeenCalled();
});

it('opens self-registration without losing the return destination', async () => {
  const { registerWithOidc } = await import('./oidc');
  await registerWithOidc();
  expect(mocks.client.register).toHaveBeenCalledWith({ redirectUri: window.location.href });
});

it('requests an email for the signed-in identity without any caller-supplied recipient', async () => {
  const { changePasswordWithOidc } = await import('./oidc');
  await changePasswordWithOidc();
  expect(mocks.fetch).toHaveBeenCalledWith('https://api.example.test/v1/auth/password-reset-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-token' }, body: '{}',
  });
  expect(mocks.client.login).not.toHaveBeenCalled();
});

it('does not offer a password update without an authenticated session', async () => {
  mocks.client.authenticated = false;
  const { changePasswordWithOidc } = await import('./oidc');
  await expect(changePasswordWithOidc()).rejects.toThrow('Sign in before');
  expect(mocks.client.login).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it('surfaces delivery failure without opening a direct password form', async () => {
  mocks.fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ message: 'Mail service unavailable' }) });
  const { changePasswordWithOidc } = await import('./oidc');
  await expect(changePasswordWithOidc()).rejects.toThrow('Mail service unavailable');
  expect(mocks.client.login).not.toHaveBeenCalled();
});
