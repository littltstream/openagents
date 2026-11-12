import { afterEach, describe, expect, it, vi } from "vitest"
import type { AccountWorkspace } from "@renderer/types"
import { DEPLOYMENT_DEFAULTS } from "../../shared/deployment"
import { inAppBlocker, opensInApp, workspaceDisplayHost, workspacePageUrl, workspaceUrl, workspaceWebBaseUrl } from "./workspace-urls"

afterEach(() => vi.unstubAllGlobals())

describe("workspace browser navigation", () => {
  it.each([
    undefined,
    "http://101.43.200.65:8000",
    "https://101.43.200.65:8000",
    "https://api.chippilot.icu",
    "http://127.0.0.1:8000",
    DEPLOYMENT_DEFAULTS.workspaceEndpoint,
  ])("opens the configured frontend for the saved API endpoint %s", (endpoint) => {
    const server = { ...DEPLOYMENT_DEFAULTS, workspaceWebUrl: "https://workspace.example.test:3443" }
    vi.stubGlobal("window", { api: { getServerConfig: () => server } })
    const ws = { id: "w1", slug: "team", endpoint, token: "device-secret" }
    expect(workspacePageUrl(ws)).toBe("https://workspace.example.test:3443/team")
    expect(workspaceWebBaseUrl()).toBe(server.workspaceWebUrl)
    expect(workspaceDisplayHost()).toBe("workspace.example.test:3443")
    expect(ws.endpoint).toBe(endpoint)
  })

  it("uses the release frontend default when the settings bridge is unavailable", () => {
    expect(workspacePageUrl({ id: "w1", slug: "team", endpoint: "http://localhost:8000" }))
      .toBe(`${DEPLOYMENT_DEFAULTS.workspaceWebUrl}/team`)
  })

  it("does not carry an old deployment's token to the configured frontend", () => {
    vi.stubGlobal("window", { api: { getServerConfig: () => DEPLOYMENT_DEFAULTS } })
    const ws = { id: "w1", slug: "team", token: "device-secret" }
    expect(workspaceUrl({ ...ws, endpoint: "https://api.chippilot.icu" }))
      .toBe(`${DEPLOYMENT_DEFAULTS.workspaceWebUrl}/team`)
    expect(workspaceUrl({ ...ws, endpoint: `${DEPLOYMENT_DEFAULTS.workspaceEndpoint}/v1/` }))
      .toBe(`${DEPLOYMENT_DEFAULTS.workspaceWebUrl}/team?token=device-secret`)
  })
})

describe("inAppBlocker", () => {
  const ws = { id: "w1", slug: "team" }
  const member: AccountWorkspace[] = [
    { workspaceId: "w1", name: "Team", slug: "team", token: null, role: "member", lastActivityAt: null },
  ]

  it("names the reason a workspace opens in the browser, so the card can say it", () => {
    expect(inAppBlocker(ws, undefined, false, member)).toBe("signedOut")
    expect(inAppBlocker({ ...ws, endpoint: "https://ws.example.com" }, undefined, true, member)).toBe("otherDeployment")
    expect(inAppBlocker({ id: "w2", slug: "other" }, undefined, true, member)).toBe("notMember")
    expect(inAppBlocker(ws, undefined, true, null)).toBe("unknown")
    expect(inAppBlocker(ws, undefined, true, member)).toBeNull()
  })
})

describe("opensInApp", () => {
  const ws = { id: "w1", slug: "team" }
  const member: AccountWorkspace[] = [
    { workspaceId: "w1", name: "Team", slug: "team", token: null, role: "owner", lastActivityAt: null },
  ]

  it("opens a workspace the account belongs to, on the configured deployment, in the app", () => {
    expect(opensInApp(ws, undefined, true, member)).toBe(true)
    // The device records the API endpoint; the setting may be empty for the default.
    expect(opensInApp({ ...ws, endpoint: `${DEPLOYMENT_DEFAULTS.workspaceEndpoint}/v1/` }, "", true, member)).toBe(true)
  })

  it("matches the account's workspace by slug when the ids differ in form", () => {
    expect(opensInApp({ id: "3da3294d", slug: "team" }, undefined, true, member)).toBe(true)
  })

  it("uses the browser for a workspace the account is not a member of", () => {
    // Opening it in the app would add the signed-in account to it as a member.
    expect(opensInApp({ id: "w2", slug: "other" }, undefined, true, member)).toBe(false)
  })

  it("uses the browser while the account's workspaces are unknown", () => {
    expect(opensInApp(ws, undefined, true, null)).toBe(false)
  })

  it("uses the browser while signed out", () => {
    expect(opensInApp(ws, undefined, false, member)).toBe(false)
  })

  it("uses the browser for a workspace on another deployment", () => {
    const elsewhere = { ...ws, endpoint: "https://ws.example.com" }
    expect(opensInApp(elsewhere, undefined, true, member)).toBe(false)
    expect(opensInApp(elsewhere, "https://ws.example.com", true, member)).toBe(true)
  })
})
