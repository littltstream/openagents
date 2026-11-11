import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appPath, loginReturnPath, stripAppPath } from './app-path';

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/new'));
afterEach(() => vi.unstubAllEnvs());

it('prefixes browser URLs and assets once without changing external links', () => {
  expect(appPath('/logo.png')).toBe('/new/logo.png');
  expect(appPath('/new/logo.png')).toBe('/new/logo.png');
  expect(appPath('/newer')).toBe('/new/newer');
  expect(appPath('https://example.test/logo.png')).toBe('https://example.test/logo.png');
  expect(appPath('//example.test/logo.png')).toBe('//example.test/logo.png');
  expect(stripAppPath('/new/team')).toBe('/team');
  expect(stripAppPath('/newer/team')).toBe('/newer/team');
});

it('contains login returns and rejects external destinations and login loops', () => {
  expect(loginReturnPath(null)).toBe('/new/');
  expect(loginReturnPath('//other.test')).toBe('/new/');
  expect(loginReturnPath('/\\other.test')).toBe('/new/');
  expect(loginReturnPath('/new/login?returnTo=/')).toBe('/new/');
  expect(loginReturnPath('/team?tab=one')).toBe('/new/team?tab=one');
  expect(loginReturnPath('/new/team?tab=one')).toBe('/new/team?tab=one');
});

it('normalizes dot segments before containing login returns within /new', () => {
  expect(loginReturnPath('/new/../outside')).toBe('/new/outside');
  expect(loginReturnPath('/new/%2e%2e/outside')).toBe('/new/outside');
  expect(loginReturnPath('/new/../login')).toBe('/new/');
});
