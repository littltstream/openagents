import type { AccountWorkspace, Workspace } from "@renderer/types"
import { DEPLOYMENT_DEFAULTS } from "../../shared/deployment"

function serverConfig() {
  return (typeof window !== "undefined" && window.api?.getServerConfig?.()) || DEPLOYMENT_DEFAULTS
}

function apiEndpoint(endpoint?: string): string {
  return (endpoint || serverConfig().workspaceEndpoint).replace(/\/+$/, "").replace(/\/v1$/, "")
}

/** Include a device token only when it belongs to the configured deployment. */
export function workspaceUrl(ws: Workspace): string {
  const url = workspacePageUrl(ws)
  return ws.token && apiEndpoint(ws.endpoint) === apiEndpoint()
    ? `${url}?token=${encodeURIComponent(ws.token)}` : url
}

/**
 * Workspace URL without the access token — for opening in a browser, where a
 * token in the address bar would leak into history and screen shares. The
 * browser session is expected to already have (or prompt for) access.
 */
export function workspacePageUrl(ws: Workspace): string {
  return `${workspaceWebBaseUrl()}/${ws.slug || ws.id}`
}

export function workspaceWebBaseUrl(): string {
  // Saved endpoints identify the Agent API, including old deployments. Every
  // browser entry uses the frontend selected in Settings, independently of it.
  return serverConfig().workspaceWebUrl.replace(/\/+$/, "")
}

/** Match against memberships fetched from the configured server. A stable ID
 * survives an API/domain migration; a slug alone only identifies a workspace
 * within the same deployment. Never use a foreign record's token to open it. */
export function accountWorkspaceMatch(
  ws: Workspace,
  configuredEndpoint: string | undefined,
  memberOf: AccountWorkspace[] | null,
): AccountWorkspace | undefined {
  const byId = memberOf?.find((m) => m.workspaceId === ws.id)
  if (byId) return byId
  if (apiEndpoint(ws.endpoint) !== apiEndpoint(configuredEndpoint)) return undefined
  return memberOf?.find((m) => !!ws.slug && m.slug === ws.slug)
}

/** The signed-in account must already belong to the current server's workspace.
 * Open it with the account session, using the canonical server slug and no
 * device token. Unknown memberships never imply permission to open in-app. */
export function opensInApp(
  ws: Workspace,
  configuredEndpoint: string | undefined,
  signedIn: boolean,
  memberOf: AccountWorkspace[] | null,
): boolean {
  return inAppBlocker(ws, configuredEndpoint, signedIn, memberOf) === null
}

/**
 * Why a workspace opens in the browser rather than the app, or null when it
 * opens in the app. The reason is shown to the user: a card that offers only
 * "Open in browser" beside one that offers both reads as a bug otherwise.
 * `unknown` is the account's workspace list still loading (or failing) — not
 * worth a sentence, since it usually resolves a moment later.
 */
export type InAppBlocker = "signedOut" | "otherDeployment" | "notMember" | "unknown"

export function inAppBlocker(
  ws: Workspace,
  configuredEndpoint: string | undefined,
  signedIn: boolean,
  memberOf: AccountWorkspace[] | null,
): InAppBlocker | null {
  if (!signedIn) return "signedOut"
  if (!memberOf) return "unknown"
  if (accountWorkspaceMatch(ws, configuredEndpoint, memberOf)) return null
  return apiEndpoint(ws.endpoint) !== apiEndpoint(configuredEndpoint) ? "otherDeployment" : "notMember"
}

export function workspaceDisplayHost(): string {
  const baseUrl = workspaceWebBaseUrl()
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
  }
}
