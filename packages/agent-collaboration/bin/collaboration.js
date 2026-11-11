#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { WorkspaceClient } = require('../../agent-connector/src/workspace-client');
const { CollaborationClient, callTool, errorResult } = require('../src');

const commands = {
  discover: 'workspace_discover_agents', profile: 'workspace_get_agent_profile',
  'create-group': 'workspace_create_group', 'send-message': 'workspace_send_message',
  'get-messages': 'workspace_get_messages',
};

const HELP = `Workspace collaboration (source checkout; Node.js 18+)

node packages/agent-collaboration/bin/collaboration.js <command> [options]

Commands: discover, profile, create-group, send-message, get-messages
Business arguments: --args-file <UTF-8 JSON file>
Discover also accepts: --query <keywords> --available-only

Connection options (or corresponding environment variables):
  --endpoint       OA_WORKSPACE_ENDPOINT (required; no default cloud server)
  --workspace-id   OA_WORKSPACE_ID
  --agent-name     OA_AGENT_NAME (must already be registered)
  --channel-name   OA_CHANNEL_NAME (originating user channel)
Credential: OA_WORKSPACE_TOKEN environment variable only; never a CLI argument.

Examples:
  ... discover --query CSV --available-only
  ... create-group --args-file group.json
  ... send-message --args-file message.json
  ... get-messages --args-file history.json
Results are JSON on stdout; errors are JSON on stderr with nonzero exit status.
`;

async function main(argv = process.argv.slice(2), env = process.env) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, endpoint: { type: 'string' },
    'workspace-id': { type: 'string' }, 'agent-name': { type: 'string' }, 'channel-name': { type: 'string' },
    'args-file': { type: 'string' }, query: { type: 'string' }, 'available-only': { type: 'boolean' },
  } });
  if (values.help) return { help: HELP };
  if (positionals.length !== 1 || !commands[positionals[0]]) throw new Error('Choose one command; run --help for usage');
  if (positionals[0] !== 'discover' && (values.query !== undefined || values['available-only'] !== undefined)) throw new Error('Discovery filters only apply to discover');
  if (values['args-file'] && (values.query !== undefined || values['available-only'] !== undefined)) throw new Error('Use either --args-file or discovery flags');
  const endpoint = values.endpoint || env.OA_WORKSPACE_ENDPOINT;
  if (!endpoint) throw new Error('Workspace endpoint is required');
  const url = new URL(endpoint);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) API endpoint without credentials, query or fragment');
  const client = new CollaborationClient({
    wsClient: new WorkspaceClient(endpoint), workspaceId: values['workspace-id'] || env.OA_WORKSPACE_ID,
    agentName: values['agent-name'] || env.OA_AGENT_NAME, token: env.OA_WORKSPACE_TOKEN,
    channelName: values['channel-name'] || env.OA_CHANNEL_NAME,
  });
  const args = values['args-file']
    ? JSON.parse(fs.readFileSync(values['args-file'], 'utf8').replace(/^\uFEFF/, ''))
    : { ...(values.query !== undefined ? { query: values.query } : {}),
      ...(values['available-only'] !== undefined ? { available_only: values['available-only'] } : {}) };
  return callTool(client, commands[positionals[0]], args);
}

if (require.main === module) {
  main().then((result) => process.stdout.write(result.help || `${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${JSON.stringify(errorResult(error, process.env.OA_WORKSPACE_TOKEN))}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
