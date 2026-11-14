# Agent collaboration

Agent-facing collaboration tools for the source checkout of OpenAgents. The
implementation lives here; the existing connector only loads the tools and
prompt section. It reuses `WorkspaceClient` and the Workspace discovery/event
handlers. No additional HTTP service, database, model, or dependencies are needed.

## Available tools

| MCP tool | CLI command | Arguments |
| --- | --- | --- |
| `workspace_discover_agents` | `discover` | Optional `query`, `available_only`, `usable_only` |
| `workspace_get_agent_profile` | `profile` | `agent` |
| `workspace_create_group` | `create-group` | `title`, `participants`, optional `origin_channel` |
| `workspace_send_message` | `send-message` | `channel`, `content`, optional `targets` |
| `workspace_get_messages` | `get-messages` | `channel`, optional `after`, `limit` |
| `workspace_put_todos` | `put-todos` | `todos` (full list of `content`, `status`, optional `assignee`), optional `channel` |
| `workspace_get_todos` | `get-todos` | Optional `channel`, `all`, `agent` |
| `workspace_get_brief` | `get-brief` | Optional group/thread `channel` |
| `workspace_update_brief` | `update-brief` | Optional `channel`; changed `objective`, `latest_result`, `open_questions`, `next_step`, `owner` |

Discovery returns published capabilities, not host directories, private tools or
knowledge. Keyword filtering is literal (space-separated terms must all match).
`usable_only` defaults to true and uses the server's `can_start_thread` flag;
offline agents remain in the list unless `available_only` is true. The coordinator
selects its own team. Profile output includes the server's published summary and
availability, not owner-only instructions or knowledge entries.

Creating a group includes the coordinator automatically and explicitly requests
private visibility. It rechecks the selected agents against fresh discovery and
returns the original user channel. It does not clone a session, copy history,
dispatch a task, or upload data. Source identity and credentials cannot be set
through tool arguments. The server-returned origin channel owner (or the human
peer of a verified native DM) is added as a human participant and owner. When a
human triggers the task in a shared channel, their identity is also resolved from
that exact server-visible event and added as a participant, so the
user can observe the private group without making it workspace-public. Agent-only
origins without a human owner remain agent-only; no user email is guessed.
The receipt includes a credential-free frontend `url`, using the canonical
`/<workspace>/threads/<channel>` route relative to the Workspace UI. Post it as
`[查看协作过程](url)` in the original conversation immediately, and retain it in
the final report. It is not an API URL and grants no access by itself.

Planning uses the existing Workspace todos API through the same scoped client in
both CLI and MCP. Writes always identify the caller and replace only their own
list. Assignments are restricted to conversation participants. Errors remain
errors; an agent must not replace a failed tool call with a raw HTTP request.

The origin may also be a native direct conversation, such as
`dm:human:owner@example.test`. DMs are not group channels: the client verifies
existing server-visible messages between the caller and that peer, queries
history with the native conversation filter, and sends reports as direct events.
It never creates a `channel/dm:...` channel or treats another Agent's DM as the
caller's conversation. The same CLI/MCP tools support creation from a DM,
recovery of its saved origin, and returning the final report to that DM.

`targets` explicitly names group members to wake. An empty/omitted list records
an informational message without waking an agent, including when its name is in
the text. Receipts distinguish recorded/routed messages from execution. If a
requested target was not routed, the tool returns an error with the stored event
ID; do not blindly retry and duplicate a message. For an interrupted write, check
the channel history before retrying.

`get-messages` initially reads the most recent window in chronological order.
Use its `next_after` as `after` for subsequent pages. Failed reads are errors,
not an empty list. The helpers do not poll in the background or automatically
dispatch the same task again.
The result also includes `collaboration` (coordinator and original user channel)
from the stored group-creation event. A new coordinator session can recover this
context after receiving a specialist reply; it need not inherit the original
CLI session. Ordinary channels return `collaboration: null`.

## Source runtime

Use Node.js 18+ and run the connector **from this checkout**, with the sibling
`packages/agent-collaboration` directory present. For example:

```powershell
node packages/agent-connector/bin/agent-connector.js --help
node packages/agent-collaboration/bin/collaboration.js --help
```

Brief updates reuse the existing Workspace brief API through the scoped client.
The client supplies network and source; callers cannot override identity. Writes
require group membership and server authorization. Omitted fields are preserved;
empty strings or an empty questions list clear the corresponding field. Native
DMs do not have a shared brief. CLI and MCP return the same structured receipt.

The connector's existing MCP server exposes the nine tools. Claude MCP mode's
allowlist includes the read tools in plan mode and write tools in execute mode.
The shared Workspace prompt/skill generator adds collaboration instructions and
CLI usage for skill-driven adapters, including Codex and OpenClaw. Child processes
inherit `OA_WORKSPACE_TOKEN` scoped to their adapter; the prompt's command supplies
the API endpoint, workspace, agent identity, and current channel.

The ChipPilot installer and desktop build bundle this package with the connector
(`scripts/build-chippilot-cli.cjs`). Users of that distribution do not separately
download a collaboration skill or configure another MCP server. Claude MCP mode
loads the connector's existing MCP server; skill-driven runtimes receive the
generated Workspace instructions and CLI commands automatically. The official
upstream `agn` / desktop distribution does not contain these fork changes.
Editing the checkout does not update an already installed app or running agent.

For per-turn CLI children and Claude MCP mode, the adapter supplies the triggering
event ID through a channel-scoped child environment. A successful targeted tool
send records that correlation. The updated backend keeps the adapter's subsequent
automatic summary visible but does not dispatch it again when the same sender,
channel and exact trigger already have a routed collaboration-tool receipt.
Uncorrelated messages and runtimes without per-turn context retain normal routing;
timestamps or response text are not used to guess which turn sent a message.

## Default capability descriptions

The source CLI and connector library accept an optional local default:

```powershell
node packages/agent-connector/bin/agent-connector.js create chip-specialist --type codex --description "分析芯片测试 CSV，返回统计汇总；原始数据保留在本机。"
```

```javascript
connector.addAgent({ name: 'chip-specialist', type: 'codex', description: 'Analyze host-local chip test CSV files.' });
```

Inspect or change an existing agent's local default without contacting Workspace:

```powershell
agn description chip-specialist
agn description chip-specialist --set "分析芯片测试 CSV，原始文件保留在本机。"
agn description chip-specialist --set=
```

`--set=` stores an explicitly empty default. Viewing does not rewrite the config;
unknown agents, missing/repeated values and descriptions over 4000 characters
are errors. A running daemon refreshes the default without restarting the agent.
This command does not update any existing Workspace description.

The local default is stored in the agent's `daemon.yaml` entry. Unicode,
multiline summaries, quotes, and Windows paths round-trip without changing the
agent's private instructions or skills. Maximum length is 4000 characters.
When the daemon actually joins a workspace, it sends this default with `/v1/join`:

- The server initializes `WorkspaceMember.description` only when it is NULL.
- Existing workspace text and explicitly cleared text (`""`) are preserved on
  every reconnect. The database update is conditional, so a web edit that races
  a reconnect also wins.
- Each workspace has an independent value. Changing the local default affects
  uninitialized memberships; edit already initialized descriptions in that
  workspace's web interface.
- Thread-specific collaboration instructions keep their existing scope and do
  not change the workspace's published discovery description.

Both `workspace_discover_agents` / `workspace_get_agent_profile` and the existing
`workspace_get_agents` MCP tool expose the workspace's description. An agent
created only locally is not discoverable until it is connected and registered.

This requires the updated backend join handler as well as the updated connector;
no database migration is required. A server that does not acknowledge the new
initialization field produces an explicit error when a default is supplied.
Joins without a default remain compatible with the previous API.

For a standalone CLI call, supply the connection context and credential through
the environment. Do not paste credentials into shell history or argument files.
Use a private launcher/configuration to populate `OA_WORKSPACE_TOKEN`.

```powershell
$env:OA_WORKSPACE_ENDPOINT = 'https://api.chippilot.icu'
$env:OA_WORKSPACE_ID = '<workspace ID or slug>'
$env:OA_AGENT_NAME = '<already registered coordinator>'
$env:OA_CHANNEL_NAME = '<original user channel>'

node packages/agent-collaboration/bin/collaboration.js discover --query CSV
node packages/agent-collaboration/bin/collaboration.js create-group --args-file group.json
```

`group.json`:

```json
{"title":"Chip test analysis","participants":["Agent_A"]}
```

Use `send-message --args-file task.json` with the returned channel:

```json
{"channel":"<returned channel>","targets":["Agent_A"],"content":"Analyze your host-local results.csv. Return counts and failure rate to the coordinator here; do not upload source rows."}
```

Retain the original user channel and return the verified result there with
`targets: []`. Raw messages are still persisted by Workspace; keeping large files
local does not make messages host-local. See
[the collaboration skill](skills/workspace-collaboration/SKILL.md) for the workflow.

## Authorization boundary

Each request carries the calling `X-Agent-Name` and existing Workspace credential.
The caller must already appear in discovery. The module uses server-filtered
discovery, rechecks `can_start_thread`, and restricts dispatch to existing channel
members. These client checks do not replace server authorization. In particular,
legacy machine-token behavior and end-user delegation still follow the current
backend; this package does not implement customer impersonation or a complete new
delegated ACL system. It also does not register or remotely invoke host resources.

## Validation

```powershell
npm --prefix packages/agent-collaboration test
python -m pytest -q packages/agent-collaboration/test/test_backend.py
node --test packages/agent-connector/test/workspace-prompt.test.js packages/agent-connector/test/presence-handoff.test.js
git diff --check
```

Tests use the actual connector client and MCP server against an isolated local
HTTP contract fixture; CLI tests launch a real Node child process. They validate
identity, requests, failures, routing receipts, and pagination without contacting
production or invoking paid models. The optional Python test requires the backend
test dependencies (including pytest and the SDK). It reuses the backend's SQLite
test setup, runs the actual FastAPI discovery/event handlers, and verifies the
coordinator → specialist → fresh coordinator → original user channel flow over
local HTTP. Specialist output is supplied by the test, so this verifies the real
backend protocol, not a two-model end-to-end run.
