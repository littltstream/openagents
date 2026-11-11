import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/new'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('does not restore or overwrite the old application session on the same origin', async () => {
  const session = { token: 'old-test-session', email: 'owner@example.test', displayName: null, expiresAt: Date.now() / 1000 + 3600 };
  const entries = new Map([['oa_workspace_session', JSON.stringify(session)]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  const { loadWorkspaceSession, saveWorkspaceSession, clearWorkspaceSession } = await import('./workspace-session');
  expect(loadWorkspaceSession()).toBeNull();
  saveWorkspaceSession({ ...session, token: 'new-test-session' });
  expect(JSON.parse(entries.get('oa_workspace_session')!).token).toBe('old-test-session');
  expect(loadWorkspaceSession()?.token).toBe('new-test-session');
  clearWorkspaceSession();
  expect(entries.has('oa_workspace_session')).toBe(true);
});

it('writes identity cookies with separate names restricted to /new/', async () => {
  const document = { cookie: '' };
  vi.stubGlobal('document', document);
  const { storeIdentity } = await import('./identity');
  storeIdentity('test-user', 'Test');
  expect(document.cookie).toContain('oa_user_name__new=Test');
  expect(document.cookie).toContain('path=/new/;');
});
