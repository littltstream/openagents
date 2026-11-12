import release from '../../../../chippilot-release.json'

export const DEPLOYMENT_DEFAULTS = {
  workspaceEndpoint: release.defaultApiUrl,
  workspaceWebUrl: release.defaultWebUrl,
  oidcIssuerUrl: release.defaultOidcIssuer,
  oidcClientId: release.oidcClientId,
  updateFeedUrl: `https://github.com/${release.repository}/releases/latest/download`,
}

export function deploymentUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const parsed = new URL(value.trim())
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an HTTP(S) URL without credentials, query, or fragment`)
  }
  return parsed.toString().replace(/\/+$/, '')
}

export type DeploymentConfig = typeof DEPLOYMENT_DEFAULTS

export function resolveDeployment(read: (key: string) => unknown): DeploymentConfig {
  const get = (key: keyof DeploymentConfig) => {
    const supplied = read(key)
    return typeof supplied === 'string' && supplied.trim() ? supplied.trim() : DEPLOYMENT_DEFAULTS[key]
  }
  return {
    workspaceEndpoint: deploymentUrl(get('workspaceEndpoint'), 'Workspace API'),
    workspaceWebUrl: deploymentUrl(get('workspaceWebUrl'), 'Workspace web URL'),
    oidcIssuerUrl: deploymentUrl(get('oidcIssuerUrl'), 'OIDC issuer'),
    oidcClientId: get('oidcClientId'),
    updateFeedUrl: deploymentUrl(get('updateFeedUrl'), 'Update feed'),
  }
}
