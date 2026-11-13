'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { turnEnvironment } = require('./turn-context');
const SKILL_PATH = path.resolve(__dirname, '../skills/workspace-collaboration/SKILL.md');
const workflow = fs.readFileSync(SKILL_PATH, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();

function buildCollaborationSection(toolMode = 'mcp') {
  const entry = toolMode === 'skills'
    ? 'Use the Agent Collaboration CLI section in your current Workspace skill; do not invent MCP tools that are not loaded.'
    : 'Use workspace_discover_agents, workspace_get_agent_profile, workspace_create_group, workspace_send_message, and workspace_get_messages.';
  return `\n### Form a specialist team\n${entry}\n\n${workflow}\n`;
}

function quote(value, isWindows) {
  const valueString = String(value);
  if (/[\r\n\x00]/.test(valueString)) throw new Error('Invalid collaboration command argument');
  return "'" + valueString.replace(/'/g, isWindows ? "''" : "'\\''") + "'";
}

function buildCliSection({ endpoint, workspaceId, agentName, channelName, mode = 'execute', todosEnabled = true, isWindows = process.platform === 'win32' }) {
  const cli = path.resolve(__dirname, '../bin/collaboration.js');
  const q = (s) => quote(s, isWindows);
  const command = `node ${q(cli)} --endpoint ${q(endpoint)} --workspace-id ${q(workspaceId)} --agent-name ${q(agentName)} --channel-name ${q(channelName)}`;
  return '\n### Agent Collaboration\n\n'
    + 'These CLI operations use the same implementation as the Workspace MCP tools. '
    + 'OA_WORKSPACE_TOKEN is supplied by the connector in the child environment; never print it or put it in an argument file.\n\n'
    + `Discover candidates: \`${command} discover --query CSV\`\n\n`
    + 'For other arguments, write a UTF-8 JSON file with your file tool, then use --args-file. '
    + `Read-only commands are profile (agent), get-messages (channel, optional after and limit)${todosEnabled ? ', and get-todos (optional channel, all, agent)' : ''}.\n`
    + `Example: \`${command} get-messages --args-file history.json\` with \`{"channel":"GROUP_CHANNEL","limit":20}\`.\n`
    + (mode === 'plan' ? `Plan mode: only discover, profile, get-messages${todosEnabled ? ', and get-todos' : ''} are permitted.\n`
      : `Create: \`${command} create-group --args-file group.json\` with \`{"title":"Test analysis","participants":["SPECIALIST_NAME"]}\`.\n`
        + `Dispatch: \`${command} send-message --args-file task.json\` with \`{"channel":"GROUP_CHANNEL","targets":["SPECIALIST_NAME"],"content":"Task, context, expected output; return findings to the coordinator here."}\`.\n`
        + (todosEnabled ? `Planning: \`${command} put-todos --args-file todos.json\` with \`{"channel":"GROUP_CHANNEL","todos":[{"content":"Analyze local data","status":"pending","assignee":"SPECIALIST_NAME"}]}\`. Replaces your entire list; only your own list is updated.\n` : 'Workspace todos are disabled for this agent.\n')
        + 'For discovery, profiles, group creation, collaboration messages/history, and todos, use these CLI commands, never curl or raw HTTP. If a tool fails or lacks a capability, report that and stop that operation; do not bypass it.\n'
        + 'Immediately announce a created group in the original conversation as [查看协作过程](RETURNED_URL), using the returned url exactly. Keep this link in the final report; a bare channel ID is insufficient.\n'
        + 'To report back to the original user channel, send-message with that channel and targets: [].\n');
}

function childEnvironment(env, token) {
  return turnEnvironment({ ...env, OA_WORKSPACE_TOKEN: token });
}

module.exports = { buildCollaborationSection, buildCliSection, childEnvironment };
