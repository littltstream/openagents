import { describe, expect, it } from 'vitest'
import { DEPLOYMENT_DEFAULTS, deploymentUrl, resolveDeployment } from './deployment'

describe('self-hosted deployment settings', () => {
  it('uses the fork deployment and release feed by default', () => {
    expect(resolveDeployment(() => undefined)).toEqual(DEPLOYMENT_DEFAULTS)
    expect(DEPLOYMENT_DEFAULTS.updateFeedUrl).toContain('littltstream/openagents')
  })
  it('keeps independently configured API, website and realm paths', () => {
    const values: Record<string, string> = { workspaceEndpoint: 'https://api.example.com/v1-api/', workspaceWebUrl: 'https://app.example.com/', oidcIssuerUrl: 'https://login.example.com/realms/team/' }
    const resolved = resolveDeployment(k => values[k])
    expect(resolved.workspaceEndpoint).toBe('https://api.example.com/v1-api')
    expect(resolved.workspaceWebUrl).toBe('https://app.example.com')
    expect(resolved.oidcIssuerUrl).toBe('https://login.example.com/realms/team')
  })
  it.each(['file:///tmp', 'javascript:alert(1)', 'https://user:password@example.com', 'https://example.com?token=secret'])('rejects unsafe server URLs: %s', url => {
    expect(() => deploymentUrl(url, 'Server')).toThrow()
  })
})
