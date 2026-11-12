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
through tool arguments.

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

The connector's existing MCP server exposes the five tools. Claude MCP mode's
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
