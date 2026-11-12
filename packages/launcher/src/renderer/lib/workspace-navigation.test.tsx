import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEPLOYMENT_DEFAULTS } from "../../shared/deployment"
import { useWorkspaceOpening } from "../pages/workspaces/use-workspace-opening"
import { useAgentActions } from "../pages/agents/use-agent-actions"
import { useAccountStore } from "../store/account"
import { openWorkspaceSite } from "../components/workspaces/quick-connect-panels"
import type { AccountWorkspace, Agent, Workspace } from "../types"

vi.mock("./analytics", () => ({ capture: vi.fn(), group: vi.fn() }))

const server = { ...DEPLOYMENT_DEFAULTS, workspaceWebUrl: "https://workspace.example.test:3443" }
const ws: Workspace = { id: "w1", slug: "team", name: "Team", token: "old-device-secret" }
const member: AccountWorkspace[] = [
  { workspaceId: ws.id, slug: ws.slug, name: "Team", token: null, role: "member", lastActivityAt: null },
]
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  useAccountStore.setState({ account: null, workspaceTarget: null })
  api = {
    getServerConfig: vi.fn(() => server),
    getSetting: vi.fn().mockResolvedValue(server.workspaceEndpoint),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    listAccountWorkspaces: vi.fn().mockResolvedValue(member),
    openExternal: vi.fn(),
  }
  vi.stubGlobal("api", api)
})

afterEach(() => vi.unstubAllGlobals())

describe("Open workspace entries", () => {
  it.each(["http://101.43.200.65:8000", "https://api.chippilot.icu", "http://127.0.0.1:8000"])(
    "opens the configured frontend from both lists for %s", async (endpoint) => {
      const saved = { ...ws, endpoint }
      api.listWorkspaces.mockResolvedValue([saved])
      const markUsed = vi.fn()
      const workspace = renderHook(() => useWorkspaceOpening(markUsed))
      act(() => workspace.result.current.openWorkspace(saved))
      await waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(`${server.workspaceWebUrl}/team`))
      expect(markUsed).toHaveBeenCalledWith(ws.id)

      api.openExternal.mockClear()
      const agent: Agent = { name: "codex1", type: "codex", state: "running", network: ws.slug, health: null }
      const actions = renderHook(() => useAgentActions(vi.fn(), vi.fn()))
      await act(() => actions.result.current.openWorkspace(agent))
      expect(api.openExternal).toHaveBeenCalledExactlyOnceWith(`${server.workspaceWebUrl}/team`)
      expect(useAccountStore.getState().workspaceTarget).toBeNull()
      expect(saved.endpoint).toBe(endpoint)
    },
  )

  it("keeps a foreign token out of the embedded workspace even for a signed-in member", async () => {
    useAccountStore.setState({ account: { email: "member@example.test", displayName: "Member", expiresAt: 9999999999 } })
    const saved = { ...ws, endpoint: "https://api.chippilot.icu" }
    api.listWorkspaces.mockResolvedValue([saved])
    const workspace = renderHook(() => useWorkspaceOpening(vi.fn()))
    act(() => workspace.result.current.openWorkspace(saved))
    await waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(`${server.workspaceWebUrl}/team`))
    const actions = renderHook(() => useAgentActions(vi.fn(), vi.fn()))
    await act(() => actions.result.current.openWorkspace({ name: "codex1", type: "codex", state: "running", network: ws.slug, health: null }))
    expect(useAccountStore.getState().workspaceTarget).toBeNull()
  })

  it("still opens the configured deployment in the app for an existing member", async () => {
    useAccountStore.setState({ account: { email: "member@example.test", displayName: "Member", expiresAt: 9999999999 } })
    const saved = { ...ws, endpoint: server.workspaceEndpoint }
    api.listWorkspaces.mockResolvedValue([saved])
    const workspace = renderHook(() => useWorkspaceOpening(vi.fn()))
    await act(async () => workspace.result.current.openWorkspace(saved))
    await waitFor(() => expect(useAccountStore.getState().workspaceTarget?.slug).toBe(ws.slug))
    useAccountStore.setState({ workspaceTarget: null })
    const actions = renderHook(() => useAgentActions(vi.fn(), vi.fn()))
    await act(() => actions.result.current.openWorkspace({ name: "codex1", type: "codex", state: "running", network: ws.slug, health: null }))
    expect(useAccountStore.getState().workspaceTarget).toEqual({ slug: ws.slug, name: ws.name, token: ws.token })
    expect(api.openExternal).not.toHaveBeenCalled()
  })

  it("opens the configured frontend to obtain a pairing code", () => {
    openWorkspaceSite()
    expect(api.openExternal).toHaveBeenCalledExactlyOnceWith(server.workspaceWebUrl)
  })
})
