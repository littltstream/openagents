'use strict';

const { CollaborationClient } = require('./client');

const string = { type: 'string', minLength: 1 };
const agents = { type: 'array', items: string, uniqueItems: true };
const defs = [
  {
    name: 'workspace_discover_agents',
    description: 'Find specialist candidates in this workspace. Filter their published capabilities by keywords; choose the team yourself. Offline agents are included unless available_only is true. Does not expose host paths or private knowledge.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', description: 'Space-separated keywords; all must match the published capability card.' },
      available_only: { type: 'boolean', default: false }, usable_only: { type: 'boolean', default: true },
    } },
  },
  {
    name: 'workspace_get_agent_profile',
    description: 'Read a specialist capability card and availability before selecting a collaboration partner.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { agent: string }, required: ['agent'] },
  },
  {
    name: 'workspace_create_group',
    description: 'Create a private collaboration group with selected agents. Automatically includes you as coordinator. Saves the originating user channel in the receipt. Creation does not dispatch a task; use workspace_send_message next.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      title: string, participants: { ...agents, minItems: 1 },
      origin_channel: { ...string, description: 'Original user channel or native dm:<peer address> conversation; defaults to the current conversation. No session history is copied.' },
    }, required: ['title', 'participants'] },
  },
  {
    name: 'workspace_send_message',
    description: 'Post in a specified group or reply to an existing native dm:<peer address> conversation. targets names existing participants to wake for actual work. Omit targets to record a result for people without waking agents. A routed receipt does not mean the task is complete.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      channel: string, content: string, targets: agents,
    }, required: ['channel', 'content'] },
  },
  {
    name: 'workspace_get_messages',
    description: 'Read group replies and saved collaboration context (coordinator, origin_channel), including in a fresh session, or read an existing native dm:<peer address> conversation. Initially returns the latest window; pass next_after as after to read subsequent messages. Do not invent results when no reply exists.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      channel: string, after: string, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    }, required: ['channel'] },
  },
];

const methods = {
  workspace_discover_agents: 'discover', workspace_get_agent_profile: 'profile',
  workspace_create_group: 'createGroup', workspace_send_message: 'sendMessage', workspace_get_messages: 'getMessages',
};
const readToolNames = ['workspace_discover_agents', 'workspace_get_agent_profile', 'workspace_get_messages'];
const writeToolNames = ['workspace_create_group', 'workspace_send_message'];

// MCP and CLI share validation, so neither interface can inject endpoint,
// credentials, source identity, owner email, or arbitrary event payloads.
function validate(name, args) {
  const tool = defs.find((d) => d.name === name);
  if (!tool) throw new Error(`Unknown collaboration tool: ${name}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
  const schema = tool.inputSchema;
  for (const key of schema.required || []) if (!Object.hasOwn(args, key)) throw new Error(`${key} is required`);
  for (const [key, value] of Object.entries(args)) {
    const field = schema.properties[key];
    if (!field) throw new Error(`Unsupported argument: ${key}`);
    const type = field.type;
    if ((type === 'array' && (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())))
      || (type === 'integer' && (!Number.isInteger(value) || value < field.minimum || value > field.maximum))
      || (['string', 'boolean'].includes(type) && typeof value !== type)
      || (type === 'string' && field.minLength && !value.trim())) throw new Error(`Invalid ${key}`);
    if (type === 'array' && field.minItems && value.length < field.minItems) throw new Error(`Invalid ${key}`);
  }
  return methods[name];
}

async function callTool(client, name, args = {}) {
  return client[validate(name, args)](args);
}

function errorResult(error, token) {
  const message = String(error.message || error);
  return { error: token ? message.split(token).join('[redacted]') : message,
    ...(error.status ? { status: error.status } : {}), ...(error.receipt ? { receipt: error.receipt } : {}) };
}

async function handle(server, name, args) {
  if (!Object.hasOwn(methods, name)) return undefined;
  try {
    const client = new CollaborationClient({ wsClient: server.ws, workspaceId: server.workspaceId,
      agentName: server.agentName, token: server.token, channelName: server.channelName,
      triggerId: server.triggerId, triggerChannel: server.triggerChannel });
    const result = await callTool(client, name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    const result = errorResult(error, server.token);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true };
  }
}

module.exports = { defs, handle, callTool, errorResult, readToolNames, writeToolNames };
