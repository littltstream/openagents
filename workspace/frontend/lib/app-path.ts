/** Next handles Link/router paths; browser URLs and public assets need the prefix explicitly. */
export function appBasePath(): string {
  return (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');
}

export function appPath(path: string): string {
  const base = appBasePath();
  if (!base || !path.startsWith('/') || path.startsWith('//')) return path;
  if (path === base || path.startsWith(base + '/') || path.startsWith(base + '?') || path.startsWith(base + '#')) return path;
  return base + path;
}

export function stripAppPath(path: string): string {
  const base = appBasePath();
  if (base && (path === base || path.startsWith(base + '/'))) return path.slice(base.length) || '/';
  return path;
}

/** Keep redirects inside this application and avoid looping back to login. */
export function loginReturnPath(target: string | null): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || /[\\\x00-\x20]/.test(target)) return appPath('/');
  try {
    const normalized = new URL(target, 'https://application.invalid');
    if (normalized.origin !== 'https://application.invalid') return appPath('/');
    const path = normalized.pathname + normalized.search + normalized.hash;
    if (stripAppPath(path).startsWith('/login')) return appPath('/');
    return appPath(path);
  } catch { return appPath('/'); }
}
