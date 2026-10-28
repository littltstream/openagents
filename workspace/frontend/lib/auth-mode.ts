/** Build-time web authentication mode. Desktop builds retain host-owned auth. */
export function usesOidcLogin(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_MODE === 'oidc';
}

export function usesInlineLogin(): boolean {
  return usesOidcLogin() || process.env.NEXT_PUBLIC_INLINE_LOGIN === '1';
}
