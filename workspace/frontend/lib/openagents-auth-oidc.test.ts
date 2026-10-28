// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OpenAgentsAuthProvider, useOpenAgentsAuth } from './openagents-auth-context';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(), identity: vi.fn(), login: vi.fn(), logout: vi.fn(),
  setRefresher: vi.fn(), firebase: vi.fn(), loadSession: vi.fn(),
}));
vi.mock('./oidc', () => ({ getOidcClient: mocks.getClient, getOidcIdentity: mocks.identity,
  signInWithOidc: mocks.login, signOutWithOidc: mocks.logout }));
vi.mock('./api', () => ({ workspaceApi: { setBearerRefresher: mocks.setRefresher } }));
vi.mock('./analytics', () => ({ capture: vi.fn(), identify: vi.fn() }));
vi.mock('./workspace-session', () => ({ loadWorkspaceSession: mocks.loadSession, clearWorkspaceSession: vi.fn() }));
vi.mock('./firebase', () => ({ signInWithGoogle: mocks.firebase }));

let root: Root, container: HTMLDivElement;
let auth: ReturnType<typeof useOpenAgentsAuth>;
const client: { onTokenExpired?: () => void; onAuthRefreshError?: () => void; onAuthLogout?: () => void } = {};
function View() { auth = useOpenAgentsAuth(); return null; }
async function mount() {
  await act(async () => root.render(React.createElement(OpenAgentsAuthProvider, null, React.createElement(View))));
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'oidc');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.getClient.mockResolvedValue(client);
  mocks.identity.mockResolvedValue({ token: 'oidc-access', user: { email: 'owner@example.test', displayName: 'Owner', photoURL: null } });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it('uses OIDC on custom domains without restoring Firebase or old workspace sessions', async () => {
  await mount();
  expect(auth.user?.email).toBe('owner@example.test');
  expect(auth.idToken).toBe('oidc-access');
  expect(auth.isOpenAgentsDomain).toBe(true);
  expect(mocks.loadSession).not.toHaveBeenCalled(); expect(mocks.firebase).not.toHaveBeenCalled();
  await act(async () => { await auth.signIn(); await auth.signOut(); });
  expect(mocks.login).toHaveBeenCalledOnce(); expect(mocks.logout).toHaveBeenCalledOnce();
});
it('refreshes the bearer and surfaces an expired session instead of retaining it', async () => {
  await mount();
  const refresher = mocks.setRefresher.mock.lastCall![0];
  mocks.identity.mockResolvedValueOnce({ token: 'new-access', user: auth.user });
  await act(async () => { expect(await refresher()).toBe('new-access'); });
  expect(mocks.identity).toHaveBeenLastCalledWith(true);
  expect(auth.idToken).toBe('new-access');
  mocks.identity.mockRejectedValueOnce(new Error('expired'));
  await act(async () => { await expect(refresher()).rejects.toThrow('expired'); });
  expect(auth.user).toBeNull(); expect(auth.idToken).toBeNull(); expect(auth.authError).toBe('expired');
});
it('shows an initialization error without falling through to Firebase', async () => {
  mocks.getClient.mockRejectedValueOnce(new Error('Keycloak unreachable'));
  await mount();
  expect(auth.loading).toBe(false); expect(auth.authError).toBe('Keycloak unreachable');
  expect(mocks.firebase).not.toHaveBeenCalled();
});
