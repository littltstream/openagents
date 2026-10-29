import { desktopHost } from './desktop-host';

const HOSTED_API = 'https://workspace-endpoint.openagents.org';

/** External clients need the backend address, not the web-only /wsapi proxy. */
export function getDirectApiBaseUrl(configured = process.env.NEXT_PUBLIC_API_URL): string {
  return (configured || HOSTED_API).replace(/\/+$/, '');
}

/** Use Next's same-origin proxy on the web; native and custom endpoints stay direct. */
export function getApiBaseUrl(configured = process.env.NEXT_PUBLIC_API_URL): string {
  const base = getDirectApiBaseUrl(configured);
  if (
    base === HOSTED_API &&
    typeof window !== 'undefined' &&
    /^https?:$/.test(window.location.protocol) &&
    !desktopHost()
  ) {
    return '/wsapi';
  }
  return base;
}
