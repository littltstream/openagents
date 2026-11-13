// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://desktop-bundle.example.test/index.html#/team"}
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  select: vi.fn(), openView: vi.fn(), resolve: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ workspaceApi: { resolveThreadLink: state.resolve } }));
vi.mock('@/lib/desktop-host', () => ({ desktopHost: () => ({}) }));
vi.mock('@/lib/share-origin', () => ({ shareOrigin: () => 'https://workspace.example.test' }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  workspace: { slug: 'team', workspaceId: 'ws-1' },
  sessions: [{ sessionId: 'group-1' }], setCurrentSessionId: state.select,
}) }));
vi.mock('./layout-context', () => ({ useLayout: () => ({ openView: state.openView }) }));
import { useDesktopThreadLinks } from './use-desktop-thread-links';

function Listener() { useDesktopThreadLinks(); return null; }
let root: Root;
let container: HTMLDivElement;
let anchor: HTMLAnchorElement;

beforeEach(async () => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Listener)); });
  anchor = document.createElement('a');
  anchor.target = '_blank';
  document.body.append(anchor);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  anchor.remove(); container.remove(); vi.restoreAllMocks();
});

it('opens a collaboration CLI relative link inside Desktop rather than opening the custom-scheme URL', async () => {
  anchor.href = '/ws-1/threads/group-1';
  // jsdom does not register Electron's standard custom schemes. Supply the
  // href observed in the real bundled UI while retaining the actual DOM attr.
  Object.defineProperty(anchor, 'href', { value: 'openagents://workspace/ws-1/threads/group-1' });
  expect(anchor.href).toBe('openagents://workspace/ws-1/threads/group-1');
  const browser = vi.spyOn(window, 'open');
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  await act(async () => { anchor.dispatchEvent(click); });
  expect(click.defaultPrevented).toBe(true);
  expect(state.select).toHaveBeenCalledWith('group-1');
  expect(state.openView).toHaveBeenCalledWith('threads');
  expect(browser).not.toHaveBeenCalled();
});

it('resolves a newly created opaque thread ID through the authorized API before discovery catches up', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  anchor.href = `/team/threads/${id}`;
  state.resolve.mockResolvedValueOnce({ session_id: 'group-1' });
  const browser = vi.spyOn(window, 'open');
  await act(async () => { anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
  expect(state.resolve).toHaveBeenCalledWith(id);
  expect(state.select).toHaveBeenCalledWith('group-1');
  expect(browser).not.toHaveBeenCalled();
});

it('uses the configured web origin for a relative thread not available in Desktop', async () => {
  anchor.href = '/team/threads/unavailable';
  const browser = vi.spyOn(window, 'open').mockReturnValue(null);
  await act(async () => { anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
  expect(browser).toHaveBeenCalledWith('https://workspace.example.test/team/threads/unavailable', '_blank');
  expect(state.select).not.toHaveBeenCalled();
});

it('does not intercept links belonging to another workspace', () => {
  anchor.href = '/another-team/threads/group-1';
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  anchor.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(false);
  expect(state.select).not.toHaveBeenCalled();
});
