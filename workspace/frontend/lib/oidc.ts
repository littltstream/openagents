import type Keycloak from 'keycloak-js';

let clientPromise: Promise<Keycloak> | undefined;

/** One initialization even when React StrictMode mounts the provider twice. */
export function getOidcClient(): Promise<Keycloak> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const url = process.env.NEXT_PUBLIC_KEYCLOAK_URL;
      const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
      const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;
      if (!url || !realm || !clientId) throw new Error('Keycloak URL, realm and client ID are required');
      const { default: KeycloakClient } = await import('keycloak-js');
      const client = new KeycloakClient({ url, realm, clientId });
      await client.init({
        onLoad: 'check-sso', flow: 'standard', pkceMethod: 'S256', checkLoginIframe: false,
        responseMode: 'query', scope: 'openid email profile',
      });
      return client;
    })();
  }
  return clientPromise;
}

export async function getOidcIdentity(forceRefresh = false) {
  const client = await getOidcClient();
  if (!client.authenticated) return null;
  await client.updateToken(forceRefresh ? -1 : 30);
  const claims = client.tokenParsed;
  if (!client.token || !claims?.email || claims.email_verified !== true) {
    throw new Error('Your Keycloak account needs a verified email address');
  }
  return {
    token: client.token,
    user: { email: String(claims.email), displayName: String(claims.name || claims.email), photoURL: null },
  };
}

export async function signInWithOidc(): Promise<void> {
  const client = await getOidcClient();
  await client.login({ redirectUri: window.location.href, scope: 'openid email profile' });
}

export async function signOutWithOidc(): Promise<void> {
  const client = await getOidcClient();
  await client.logout({ redirectUri: window.location.origin + '/login' });
}
