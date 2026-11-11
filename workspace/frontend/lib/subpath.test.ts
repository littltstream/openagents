import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { redirectToLogin } from './auth-redirects';
import { requestedResource } from './resource-link';
import { requestedMessageId, requestedThreadId, threadLink, workspaceThreadLink } from './thread-link';
import { shareOrigin } from './share-origin';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/new');
  vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'oidc');
  vi.stubEnv('NEXT_PUBLIC_INLINE_LOGIN', '1');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('keeps signed-out navigation and the return destination under the deployment prefix', () => {
  const replace = vi.fn();
  vi.stubGlobal('window', { location: {
    hostname: 'openagents.chippilot.icu', pathname: '/new/team', search: '?tab=one', hash: '', replace,
  } });
  redirectToLogin();
  expect(replace).toHaveBeenCalledWith('/new/login?returnTo=%2Fnew%2Fteam%3Ftab%3Done');
});

it('recognizes resource and message links beneath the deployment prefix', () => {
  expect(requestedResource('https://openagents.chippilot.icu/new/team/files/file-one'))
    .toEqual({ view: 'files', id: 'file-one' });
  expect(requestedThreadId('/new/team/threads/thread-one/messages/message-one')).toBe('thread-one');
  expect(requestedMessageId('/new/team/threads/thread-one/messages/message-one')).toBe('message-one');
  expect(workspaceThreadLink('https://openagents.chippilot.icu/new/team/threads/thread-one',
    ['https://openagents.chippilot.icu'], ['team'])).toEqual({ thread: 'thread-one', message: null });
});

it('preserves the deployment prefix in copied thread and share links', () => {
  const location = new URL('https://openagents.chippilot.icu/new/team');
  vi.stubGlobal('window', { location });
  expect(shareOrigin()).toBe('https://openagents.chippilot.icu/new');
  expect(threadLink(shareOrigin(), 'team', 'thread-one'))
    .toBe('https://openagents.chippilot.icu/new/team/threads/thread-one');
});
