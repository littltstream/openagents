import { appBasePath } from './app-path';

/** A path prefix does not isolate origin-wide Web Storage; scope its keys explicitly. */
export function scopedStorageKey(key: string): string {
  const base = appBasePath();
  return base ? `openagents:${base}:${key}` : key;
}

export function scopedCookieName(name: string): string {
  const base = appBasePath();
  return base ? `${name}__${base.slice(1).replace(/[^a-zA-Z0-9_-]/g, '_')}` : name;
}

export const scopedLocalStorage = {
  getItem: (key: string) => localStorage.getItem(scopedStorageKey(key)),
  setItem: (key: string, value: string) => localStorage.setItem(scopedStorageKey(key), value),
  removeItem: (key: string) => localStorage.removeItem(scopedStorageKey(key)),
};

export const scopedSessionStorage = {
  getItem: (key: string) => sessionStorage.getItem(scopedStorageKey(key)),
  setItem: (key: string, value: string) => sessionStorage.setItem(scopedStorageKey(key), value),
  removeItem: (key: string) => sessionStorage.removeItem(scopedStorageKey(key)),
};
