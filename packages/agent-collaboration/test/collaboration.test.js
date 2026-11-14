'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { WorkspaceClient } = require('../../agent-connector/src/workspace-client');
const { McpServer, buildToolDefs } = require('../../agent-connector/src/mcp-server');
const { CollaborationClient, callTool, buildCliSection, withCollaborationTurn } = require('../src');
const { buildApiSkillsPrompt } = require('../../agent-connector/src/adapters/workspace-prompt');
const BaseAdapter = require('../../agent-connector/src/adapters/base');
const ClaudeAdapter = require('../../agent-connector/src/adapters/claude');

const TOKEN = 'fixture-credential-not-a-real-key';
const CLI = path.resolve(__dirname, '../bin/collaboration.js');

// An HTTP contract fixture, not a replacement Workspace implementation or a
// claimed multi-model E2E test. All requests use the real WorkspaceClient.
async function fixture(t) {
  const state = {
    requests: [], writes: [], creations: new Map(), groups: 0, error: null, unrouted: false,
    agents: [
      { address: 'openagents:Agent_B', status: 'online', can_start_thread: true },
      { address: 'openagents:Agent_A', status: 'online', can_start_thread: true, agent_type: 'codex',
        description: '芯片测试 CSV analysis', purpose: 'Analyze tests', enabled_skills: ['csv'],
        working_dir: '/private/chips', server_host: 'private-host', shared_instructions: 'private instructions' },
      { address: 'openagents:Agent_C', status: 'online', can_start_thread: true, description: 'FPGA', presence_state: 'working', queue_depth: 1 },
      { address: 'openagents:Agent_D', status: 'offline', can_start_thread: true, description: 'CSV' },
      { address: 'openagents:Denied', status: 'online', can_start_thread: false, description: 'CSV' },
    ],
    channels: [
      { address: 'channel/general', participants: ['Agent_B'], visibility: 'private', owner_email: 'owner@example.test' },
      { address: 'channel/readable', participants: ['Agent_A'], visibility: 'public' },
    ],
    directMessages: [],
    todos: new Map(),
    briefs: new Map(),
    messages: [
      { id: 'event-1', source: 'openagents:Agent_A', timestamp: 1, payload: { content: 'first' } },
      { id: 'event-2', source: 'openagents:Agent_A', timestamp: 2, payload: { content: 'second' } },
    ],
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    state.requests.push({ method: req.method, url, headers: req.headers, body });
    const reply = (data, status = 200, code = 0) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code, message: code ? 'access denied' : 'ok', data }));
    };
    if (state.error === 'http') return reply(null, 403, 403);
    if (state.error === 'envelope') return reply(null, 200, 403);
    if (state.error === 'html') { res.writeHead(502); return res.end('<html>proxy failed</html>'); }
    if (url.pathname === '/v1/discover') return reply({ agents: state.agents, channels: state.channels });
    const briefRoute = url.pathname.match(/^\/v1\/channels\/([^/]+)\/brief$/);
    if (briefRoute) {
      if (state.briefError) return reply(null, 403, 403);
      const channel = decodeURIComponent(briefRoute[1]);
      const previous = state.briefs.get(channel) || { channel, objective: null, open_questions: [] };
      if (req.method === 'PUT') {
        const { network, source, ...fields } = body;
        state.briefs.set(channel, { ...previous, ...fields, updated_by: source });
      }
      return reply(state.briefs.get(channel) || previous);
    }
    if (url.pathname === '/v1/todos') {
      if (req.method === 'PUT') {
        state.todos.set(`${body.channel}:${body.source}`, body.todos.map((item) => ({ ...item, created_by: body.source })));
        return reply({ todos: state.todos.get(`${body.channel}:${body.source}`) });
      }
      return reply({ todos: state.todos.get(`${url.searchParams.get('channel')}:${url.searchParams.get('source')}`) || [] });
    }
    if (url.pathname.endsWith('/profile')) return reply({ agent_name: 'Agent_A', purpose: 'CSV tests',
      availability: { reason: 'available', runtime_name: 'PRIVATE HOST', busy_channels: ['private-channel'] },
      shared_instructions: 'DO NOT EXPOSE', allowed_knowledge: ['PRIVATE'] });
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      if (url.searchParams.get('type') === 'network.channel.create') {
        const creation = state.creations.get(url.searchParams.get('channel'));
        return reply({ events: creation ? [creation] : [] });
      }
      const conversation = url.searchParams.get('conversation');
      const pair = conversation && conversation.split(',');
      const messages = pair ? state.directMessages.filter((m) => m.visibility === 'direct'
        && ((m.source === pair[0] && m.target === pair[1]) || (m.source === pair[1] && m.target === pair[0]))) : state.messages;
      const after = url.searchParams.get('after');
      const start = after ? messages.findIndex((m) => m.id === after) + 1 : 0;
      let events = messages.slice(start);
      if (url.searchParams.get('sort') === 'desc') events.reverse();
      return reply({ events: events.slice(0, Number(url.searchParams.get('limit'))) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/events') {
      state.writes.push(body);
      if (body.type === 'network.channel.create') {
        const name = `group-${++state.groups}`;
        state.channels.push({ address: `channel/${name}`, participants: body.payload.participants, visibility: 'private', owner_email: body.payload.owner_email });
        const creation = { id: `created-${state.groups}`, ...body,
          metadata: { ...body.metadata, channel_name: name, channel_id: `id-${name}`, visibility: 'private' } };
        state.creations.set(name, creation);
        return reply(creation);
      }
      const sent = { id: `sent-${state.writes.length}`, ...body,
        metadata: { ...body.metadata, target_agents: state.unrouted ? ['__no_response__'] : body.metadata.explicit_targets } };
      if (sent.visibility === 'direct') state.directMessages.push(sent);
      return reply(sent);
    }
    return reply(null, 404, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const ws = new WorkspaceClient(endpoint);
  const client = new CollaborationClient({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: 'general' });
  return { state, client, ws, endpoint };
}

function child(file, args, env = {}) {
  const proc = spawn(process.execPath, [file, ...args], { env: { ...process.env, ...env }, windowsHide: true });
  let stdout = '', stderr = '';
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (s) => { stdout += s; });
  proc.stderr.on('data', (s) => { stderr += s; });
  return new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('discovery preserves capability cards, filters access/availability, and carries the caller identity', async (t) => {
  const { client, state } = await fixture(t);
  assert.deepEqual((await client.discover({ query: 'CSV' })).agents.map((a) => a.agent_name), ['Agent_A', 'Agent_D']);
  const available = await client.discover({ query: 'CSV', available_only: true });
  assert.equal(available.total, 1);
  assert.match(available.agents[0].description, /芯片测试/);
  assert.deepEqual(available.agents[0].enabled_skills, ['csv']);
  assert.equal('working_dir' in available.agents[0], false);
  assert.equal('server_host' in available.agents[0], false);
  assert.equal('shared_instructions' in available.agents[0], false);
  assert.equal((await client.discover({ query: 'CSV', usable_only: false })).total, 3);
  assert.equal((await client.discover({ query: 'FPGA', available_only: true })).total, 0);
  for (const request of state.requests) {
    assert.equal(request.headers['x-agent-name'], 'Agent_B');
    assert.equal(request.headers['x-workspace-token'], TOKEN);
    assert.equal(request.url.searchParams.get('network'), 'ws-1');
  }
});

test('an unknown caller cannot expose legacy machine discovery results', async (t) => {
  const { client, state } = await fixture(t);
  state.agents.shift();
  await assert.rejects(() => client.discover(), /already be registered/);
});

test('profile does not expose owner instructions or private knowledge even with a machine credential', async (t) => {
  const { client } = await fixture(t);
  const card = await client.profile({ agent: 'Agent_A' });
  assert.equal(card.purpose, 'CSV tests');
  assert.equal(card.availability.reason, 'available');
  assert.equal('runtime_name' in card.availability, false);
  assert.equal('busy_channels' in card.availability, false);
  assert.equal('shared_instructions' in card, false);
  assert.equal('allowed_knowledge' in card, false);
});

test('group creation rechecks candidates and origin membership before any write', async (t) => {
  const { client, state } = await fixture(t);
  for (const participants of [['Denied'], ['Unknown'], ['Agent_B']]) {
    await assert.rejects(() => client.createGroup({ title: 'analysis', participants }));
  }
  await assert.rejects(() => client.createGroup({ title: 'analysis', participants: ['Agent_A'], origin_channel: 'readable' }), /participant/);
  assert.equal(state.writes.length, 0);
  // Revoked since the model's earlier discovery must also be rejected.
  await client.discover();
  state.agents[1].can_start_thread = false;
  await assert.rejects(() => client.createGroup({ title: 'analysis', participants: ['Agent_A'] }), /not available/);
  assert.equal(state.writes.length, 0);
});

test('dynamic teams, explicit dispatch, and informational reports reuse the existing event protocol', async (t) => {
  const { client, state } = await fixture(t);
  const group = await client.createGroup({ title: '芯片测试', participants: ['Agent_A', 'Agent_C'] });
  assert.deepEqual(group.participants, ['Agent_B', 'Agent_A', 'Agent_C']);
  assert.equal(group.origin_channel, 'general');
  assert.equal(group.visibility, 'private');
  assert.deepEqual(group.human_participants, ['owner@example.test']);
  assert.equal(group.url, '/ws-1/threads/id-group-1');
  assert.equal(client.channelName, 'general', 'creating a team must not lose the user conversation');
  const created = state.writes[0];
  assert.equal(created.network, 'ws-1');
  assert.equal(created.source, 'openagents:Agent_B');
  assert.equal(created.type, 'network.channel.create');
  assert.equal(created.target, 'core');
  assert.equal(created.payload.visibility, 'private');
  assert.equal(created.payload.master, 'Agent_B');
  assert.deepEqual(created.payload.human_participants, ['owner@example.test']);
  assert.equal(created.payload.owner_email, 'owner@example.test');
  assert.equal('human_access' in created.metadata.collaboration, false);
  assert.equal('resume_from' in created.payload, false);
  assert.equal(created.metadata.collaboration.origin_channel, 'general');
  const routed = await client.sendMessage({ channel: group.channel, content: 'Analyze your host-local CSV', targets: ['Agent_A'] });
  assert.equal(routed.status, 'routed');
  const sent = state.writes[1];
  assert.deepEqual(sent.metadata.explicit_targets, ['Agent_A']);
  assert.equal(sent.metadata.collaboration_tool, 'workspace_send_message');
  assert.equal(sent.target, `channel/${group.channel}`);
  assert.equal(sent.source, 'openagents:Agent_B');
  await assert.rejects(() => client.sendMessage({ channel: group.channel, content: 'work', targets: ['Agent_D'] }), /not a participant/);
  await assert.rejects(() => client.sendMessage({ channel: group.channel, content: 'work', targets: ['Agent_B'] }), /yourself/);
  const report = await client.sendMessage({ channel: group.origin_channel, content: 'Agent_A found 10 failures.' });
  assert.equal(report.status, 'recorded');
  assert.deepEqual(state.writes[2].metadata.explicit_targets, ['__no_response__']);
});

test('unrouted dispatch is an error containing the recorded event receipt', async (t) => {
  const { client, state } = await fixture(t);
  const group = await client.createGroup({ title: 'test', participants: ['Agent_A'] });
  state.unrouted = true;
  await assert.rejects(() => client.sendMessage({ channel: group.channel, content: 'work', targets: ['Agent_A'] }), (error) => {
    assert.equal(error.receipt.channel, group.channel);
    assert.deepEqual(error.receipt.unrouted_agents, ['Agent_A']);
    assert.match(error.receipt.event_id, /^sent-/);
    return true;
  });
  assert.equal(state.writes.length, 2, 'must not retry a recorded message');
});

test('a shared-origin requester gains visibility without accepting an arbitrary email from tool arguments', async (t) => {
  const { ws, state } = await fixture(t);
  state.messages.push({ id: 'human-request', source: 'human:requester@example.test',
    payload: { content: 'Delegate my task', sender_email: 'requester@example.test' } });
  const client = new CollaborationClient({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN,
    channelName: 'general', triggerId: 'human-request', triggerChannel: 'general' });
  const group = await client.createGroup({ title: 'Shared-origin team', participants: ['Agent_A'] });
  assert.deepEqual(group.human_participants, ['owner@example.test', 'requester@example.test']);
  assert.deepEqual(state.writes[0].payload.human_participants, group.human_participants);
  state.messages.length = 0;
  await assert.rejects(() => client.createGroup({ title: 'Missing requester', participants: ['Agent_A'] }), /triggering event/);
  assert.equal(state.writes.length, 1);
});

test('specialist and fresh coordinator sessions recover the origin without sharing local session files', async (t) => {
  const { client, ws, state } = await fixture(t);
  const group = await client.createGroup({ title: 'analysis', participants: ['Agent_A'] });
  await client.sendMessage({ channel: group.channel, targets: ['Agent_A'], content: 'Analyze your local CSV' });
  const specialist = new CollaborationClient({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_A', token: TOKEN, channelName: group.channel });
  const context = (await specialist.getMessages({ channel: group.channel })).collaboration;
  assert.deepEqual(context, { coordinator: 'Agent_B', origin_channel: 'general' });
  await specialist.sendMessage({ channel: group.channel, targets: [context.coordinator], content: 'Verified summary from local data' });
  assert.equal(state.writes[2].source, 'openagents:Agent_A');
  assert.equal(state.writes[2].metadata.collaboration.origin_channel, 'general');
  const restarted = new CollaborationClient({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: group.channel });
  const recovered = await restarted.getMessages({ channel: group.channel });
  await restarted.sendMessage({ channel: recovered.collaboration.origin_channel, content: 'Final verified summary', targets: [] });
  assert.equal(state.writes[3].target, 'channel/general');
  assert.deepEqual(state.writes[3].metadata.explicit_targets, ['__no_response__']);
});

test('history returns a chronological latest window and a usable forward cursor', async (t) => {
  const { client, state } = await fixture(t);
  const initial = await client.getMessages({ channel: 'general', limit: 1 });
  assert.deepEqual(initial.messages.map((m) => m.id), ['event-2']);
  state.messages.push({ id: 'event-3', payload: { content: 'result' } });
  const next = await client.getMessages({ channel: 'general', after: initial.next_after });
  assert.deepEqual(next.messages.map((m) => m.id), ['event-3']);
  assert.equal(next.next_after, 'event-3');
  const empty = await client.getMessages({ channel: 'general', after: next.next_after });
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.next_after, 'event-3');
  await assert.rejects(() => client.getMessages({ channel: 'invisible' }), /not visible/);
});

test('direct user conversations can create teams, recover the origin, and receive the final report', async (t) => {
  const { state, ws } = await fixture(t);
  const origin = 'dm:human:owner@example.test';
  state.directMessages.push({ id: 'dm-request', source: 'human:owner@example.test', target: 'openagents:Agent_B',
    visibility: 'direct', payload: { content: 'Analyze chip tests' } });
  const client = new CollaborationClient({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: origin });
  const group = await client.createGroup({ title: 'DM-origin team', participants: ['Agent_A'] });
  assert.equal(group.origin_channel, origin);
  assert.deepEqual(group.human_participants, ['owner@example.test']);
  await client.sendMessage({ channel: group.channel, targets: ['Agent_A'], content: 'Compute locally' });
  const specialist = new CollaborationClient({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_A', token: TOKEN, channelName: group.channel });
  assert.deepEqual((await specialist.getMessages({ channel: group.channel })).collaboration, { coordinator: 'Agent_B', origin_channel: origin });
  await specialist.sendMessage({ channel: group.channel, targets: ['Agent_B'], content: 'Computed result' });
  const fresh = new CollaborationClient({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: group.channel });
  const context = (await fresh.getMessages({ channel: group.channel })).collaboration;
  const report = await fresh.sendMessage({ channel: context.origin_channel, targets: [], content: 'Final verified summary' });
  assert.equal(report.status, 'recorded');
  const sent = state.writes.at(-1);
  assert.equal(sent.target, 'human:owner@example.test');
  assert.equal(sent.visibility, 'direct');
  assert.deepEqual(sent.metadata.target_agents, ['__no_response__']);
  const history = await fresh.getMessages({ channel: origin });
  assert.deepEqual(history.messages.map((m) => m.id), ['dm-request', report.event_id]);
  assert.equal(history.collaboration, null);
  const later = await fresh.getMessages({ channel: origin, after: 'dm-request' });
  assert.deepEqual(later.messages.map((m) => m.id), [report.event_id]);
  assert.ok(state.requests.some((r) => r.url.searchParams.get('conversation') === 'openagents:Agent_B,human:owner@example.test'));
  assert.equal(state.requests.some((r) => r.url.searchParams.get('channel')?.startsWith('dm:')), false);
});

test('direct conversation validation rejects unrelated histories, malformed peers, and unrelated dispatch targets', async (t) => {
  const { client, state } = await fixture(t);
  const origin = 'dm:human:owner@example.test';
  state.directMessages.push({ id: 'other-agent-dm', source: 'human:owner@example.test', target: 'openagents:Agent_A', visibility: 'direct' });
  await assert.rejects(() => client.createGroup({ title: 'No prior conversation', participants: ['Agent_A'], origin_channel: origin }), /direct conversation/i);
  await assert.rejects(() => client.getMessages({ channel: origin }), /direct conversation/i);
  for (const name of ['dm:', 'dm:human:', 'dm:human:system', 'dm:human:owner@example.test,openagents:Agent_A', 'dm:channel/general', 'dm:openagents:Agent_B', 'dm:unknown:peer']) {
    await assert.rejects(() => client.sendMessage({ channel: name, content: 'Must not send' }));
  }
  assert.equal(state.writes.length, 0);
  state.directMessages.push({ id: 'own-dm', source: 'human:owner@example.test', target: 'openagents:Agent_B', visibility: 'direct' });
  await assert.rejects(() => client.sendMessage({ channel: origin, targets: ['Agent_A'], content: 'Must not wake a third party' }), /participant/);
  assert.equal(state.writes.length, 0);
  state.error = 'http';
  await assert.rejects(() => client.createGroup({ title: 'Denied', participants: ['Agent_A'], origin_channel: origin }));
});

test('the actual collaboration CLI accepts direct user origins and reads direct conversation history', async (t) => {
  const { endpoint, state } = await fixture(t);
  const origin = 'dm:human:owner@example.test';
  state.directMessages.push({ id: 'cli-dm-request', source: 'human:owner@example.test', target: 'openagents:Agent_B',
    visibility: 'direct', payload: { content: 'Delegate this task' } });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-dm-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'args.json');
  const args = ['--endpoint', endpoint, '--workspace-id', 'ws-1', '--agent-name', 'Agent_B', '--channel-name', origin];
  fs.writeFileSync(file, JSON.stringify({ title: 'CLI DM team', participants: ['Agent_A'] }));
  const created = await child(CLI, [...args, 'create-group', '--args-file', file], { OA_WORKSPACE_TOKEN: TOKEN });
  assert.equal(created.code, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).origin_channel, origin);
  fs.writeFileSync(file, JSON.stringify({ channel: origin }));
  const history = await child(CLI, [...args, 'get-messages', '--args-file', file], { OA_WORKSPACE_TOKEN: TOKEN });
  assert.equal(history.code, 0, history.stderr);
  assert.equal(JSON.parse(history.stdout).messages[0].id, 'cli-dm-request');
});

test('native agent DMs only dispatch to their peer and MCP accepts a human DM origin', async (t) => {
  const { client, ws, state } = await fixture(t);
  state.directMessages.push({ id: 'agent-dm', source: 'openagents:Agent_A', target: 'openagents:Agent_B', visibility: 'direct' });
  const sent = await client.sendMessage({ channel: 'dm:openagents:Agent_A', targets: ['Agent_A'], content: 'A directed reply' });
  assert.deepEqual(sent.routed_agents, ['Agent_A']);
  assert.equal(state.writes.at(-1).target, 'openagents:Agent_A');
  assert.equal(state.writes.at(-1).visibility, 'direct');
  await assert.rejects(() => client.sendMessage({ channel: 'dm:openagents:Agent_A', targets: ['Agent_C'], content: 'Wrong peer' }), /participant/);
  const origin = 'dm:human:owner@example.test';
  state.directMessages.push({ id: 'mcp-dm', source: 'human:owner@example.test', target: 'openagents:Agent_B', visibility: 'direct' });
  const mcp = new McpServer({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: origin });
  const group = await mcp._dispatch('workspace_create_group', { title: 'MCP DM team', participants: ['Agent_A'] });
  assert.equal(group.structuredContent.origin_channel, origin);
  const report = await mcp._dispatch('workspace_send_message', { channel: origin, content: 'MCP report', targets: [] });
  assert.equal(report.structuredContent.status, 'recorded');
  assert.equal(state.writes.at(-1).target, 'human:owner@example.test');
});

test('HTTP errors, rejected envelopes, and proxy HTML never become empty/success results', async (t) => {
  const { client, state } = await fixture(t);
  for (const mode of ['http', 'envelope', 'html']) {
    state.error = mode;
    await assert.rejects(() => client.discover(), (e) => { assert.equal(e.status, mode === 'html' ? 502 : 403); return true; });
    await assert.rejects(() => client.getMessages({ channel: 'general' }));
  }
});

test('business arguments cannot override credentials, endpoint, actor, or visibility', async (t) => {
  const { client, state } = await fixture(t);
  for (const key of ['token', 'endpoint', 'source', 'owner_email', 'visibility']) {
    await assert.rejects(() => callTool(client, 'workspace_create_group', { title: 'x', participants: ['Agent_A'], [key]: 'injected' }), /Unsupported argument/);
  }
  await assert.rejects(() => callTool(client, 'workspace_discover_agents', { available_only: 'yes' }), /Invalid/);
  await assert.rejects(() => callTool(client, 'workspace_get_messages', { channel: 'general', limit: 101 }), /Invalid/);
  assert.equal(state.requests.length, 0);
});

test('existing MCP tools expose structured collaboration results and explicit failures', async (t) => {
  const { ws, state } = await fixture(t);
  const server = new McpServer({ wsClient: ws, workspaceId: 'ws-1', channelName: 'general', agentName: 'Agent_B', token: TOKEN });
  const toolNames = buildToolDefs(new Set()).map((d) => d.name);
  assert.equal(new Set(toolNames).size, toolNames.length);
  for (const name of ['workspace_discover_agents', 'workspace_get_agent_profile', 'workspace_create_group', 'workspace_send_message', 'workspace_get_messages']) assert.ok(toolNames.includes(name));
  const found = await server._dispatch('workspace_discover_agents', { query: 'CSV', available_only: true });
  assert.equal(found.structuredContent.agents[0].agent_name, 'Agent_A');
  assert.equal(JSON.parse(found.content[0].text).total, 1);
  state.error = 'http';
  const denied = await server._dispatch('workspace_get_messages', { channel: 'general' });
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.status, 403);
  assert.equal(JSON.stringify(denied).includes(TOKEN), false);
});

test('CLI executes the same tools with UTF-8/BOM argument files and nonzero failures', async (t) => {
  const { endpoint, state } = await fixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-collaboration-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { OA_WORKSPACE_ENDPOINT: endpoint, OA_WORKSPACE_ID: 'ws-1', OA_AGENT_NAME: 'Agent_B', OA_WORKSPACE_TOKEN: TOKEN, OA_CHANNEL_NAME: 'general' };
  const found = await child(CLI, ['discover', '--query', 'CSV', '--available-only'], env);
  assert.equal(found.code, 0, found.stderr);
  assert.equal(JSON.parse(found.stdout).agents[0].agent_name, 'Agent_A');
  const argsFile = path.join(dir, 'group.json');
  fs.writeFileSync(argsFile, '\uFEFF' + JSON.stringify({ title: '芯片测试', participants: ['Agent_A'] }));
  const group = await child(CLI, ['create-group', '--args-file', argsFile], env);
  assert.equal(group.code, 0, group.stderr);
  assert.equal(JSON.parse(group.stdout).visibility, 'private');
  assert.equal(state.writes[0].payload.title, '芯片测试');
  state.error = 'http';
  const rejected = await child(CLI, ['discover'], env);
  assert.equal(rejected.code, 1);
  assert.equal(rejected.stdout, '');
  assert.equal(JSON.parse(rejected.stderr).status, 403);
  assert.equal(rejected.stderr.includes(TOKEN), false);
  const noEndpoint = await child(CLI, ['discover'], { ...env, OA_WORKSPACE_ENDPOINT: '' });
  assert.equal(noEndpoint.code, 1);
  assert.match(noEndpoint.stderr, /endpoint is required/);
});

test('skills-mode uses the actual CLI and adapter credentials without putting the token in commands', async (t) => {
  const { endpoint } = await fixture(t);
  const supplied = { PATH: process.env.PATH, OA_WORKSPACE_TOKEN: 'another-adapter' };
  const adapter = new BaseAdapter({ workspaceId: 'ws-1', channelName: 'general', agentName: 'Agent_B', endpoint, token: TOKEN, agentEnv: supplied });
  assert.equal(adapter.agentEnv.OA_WORKSPACE_TOKEN, TOKEN);
  assert.equal(supplied.OA_WORKSPACE_TOKEN, 'another-adapter');
  const args = { endpoint, workspaceId: 'ws-1', agentName: 'Agent_B', channelName: 'general' };
  const section = buildCliSection(args);
  assert.equal(section.includes(TOKEN), false);
  const command = section.match(/Discover candidates: `([^`]+)`/)[1];
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
  const proc = spawn(shell, shellArgs, { env: { ...process.env, ...adapter.agentEnv }, windowsHide: true });
  let stdout = '', stderr = '';
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (s) => { stdout += s; }); proc.stderr.on('data', (s) => { stderr += s; });
  const code = await new Promise((resolve, reject) => { proc.on('error', reject); proc.on('close', resolve); });
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).total, 2);
  const plan = buildApiSkillsPrompt({ ...args, token: TOKEN, mode: 'plan' });
  assert.equal(plan.includes('create-group --args-file'), false);
  assert.equal(plan.includes('send-message --args-file'), false);
  const execute = buildApiSkillsPrompt({ ...args, token: TOKEN });
  assert.match(execute, /put-todos --args-file/);
  assert.match(execute, /get-todos/);
  assert.match(execute, /查看协作过程/);
  assert.doesNotMatch(execute, /curl(?:\.exe)?[^\n]*\/v1\/(?:todos|discover)/);
  assert.doesNotMatch(execute, /curl(?:\.exe)?[^\n]*\/v1\/events\?[^\n]*sort=desc/);
  assert.doesNotMatch(execute, /ALWAYS use.*curl.*workspace operations/);
});

test('shared briefs use the same scoped implementation through CLI and MCP without raw HTTP arguments', async (t) => {
  const { client, state, endpoint, ws } = await fixture(t);
  const group = await client.createGroup({ title: 'Brief team', participants: ['Agent_A'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-brief-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'brief.json');
  fs.writeFileSync(file, JSON.stringify({ channel: group.channel, objective: 'Analyze the local CSV', latest_result: 'Dispatched', open_questions: ['Await result'], owner: 'openagents:Agent_A' }));
  const env = { OA_WORKSPACE_ENDPOINT: endpoint, OA_WORKSPACE_ID: 'ws-1', OA_AGENT_NAME: 'Agent_B', OA_WORKSPACE_TOKEN: TOKEN, OA_CHANNEL_NAME: 'general' };
  const updated = await child(CLI, ['update-brief', '--args-file', file], env);
  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(JSON.parse(updated.stdout).brief.updated_by, 'openagents:Agent_B');
  const request = state.requests.find(r => r.method === 'PUT' && r.url.pathname.endsWith('/brief'));
  assert.equal(request.body.network, 'ws-1');
  assert.equal(request.body.source, 'openagents:Agent_B');
  assert.equal(request.headers['x-agent-name'], 'Agent_B');
  const mcp = new McpServer({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: group.channel });
  const receipt = await mcp._dispatch('workspace_update_brief', { latest_result: '', open_questions: [] });
  assert.equal(receipt.structuredContent.brief.objective, 'Analyze the local CSV');
  assert.equal(receipt.structuredContent.brief.latest_result, '');
  assert.deepEqual(receipt.structuredContent.brief.open_questions, []);
  fs.writeFileSync(file, JSON.stringify({ channel: group.channel }));
  const read = await child(CLI, ['get-brief', '--args-file', file], env);
  assert.equal(read.code, 0, read.stderr);
  assert.deepEqual(JSON.parse(read.stdout), (await mcp._dispatch('workspace_get_brief', {})).structuredContent);
  const count = state.requests.filter(r => r.method === 'PUT').length;
  for (const args of [{ source: 'openagents:Agent_A' }, { network: 'other' }, { next_owner: 'Agent_A' }, { open_questions: [1] }, {}]) {
    assert.equal((await mcp._dispatch('workspace_update_brief', args)).isError, true);
  }
  await assert.rejects(() => client.updateBrief({ channel: 'readable', objective: 'Unauthorized edit' }), /participant/);
  await assert.rejects(() => client.getBrief({ channel: 'dm:human:someone@example.test' }), /do not have/);
  assert.equal(state.requests.filter(r => r.method === 'PUT').length, count);
  state.briefError = true;
  assert.equal((await mcp._dispatch('workspace_update_brief', { next_step: 'Verify' })).isError, true);
  const defs = buildToolDefs(new Set());
  for (const name of ['workspace_get_brief', 'workspace_update_brief']) assert.equal(defs.filter(t => t.name === name).length, 1);
  const prompt = buildApiSkillsPrompt({ endpoint, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: group.channel });
  assert.match(prompt, /update-brief --args-file/);
  assert.doesNotMatch(prompt, /PUT \/v1\/channels\/<thread>\/brief/);
  const plan = buildApiSkillsPrompt({ endpoint, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: group.channel, mode: 'plan' });
  assert.match(plan, /get-brief/);
  assert.doesNotMatch(plan, /update-brief --args-file/);
});

test('planning uses the same scoped implementation through CLI and MCP, with explicit failures', async (t) => {
  const { client, state, endpoint, ws } = await fixture(t);
  const group = await client.createGroup({ title: 'Planning team', participants: ['Agent_A'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-planning-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'todos.json');
  const args = { channel: group.channel, todos: [{ content: 'Run local CSV analysis', status: 'pending', assignee: 'Agent_A' }] };
  fs.writeFileSync(file, JSON.stringify(args));
  const env = { OA_WORKSPACE_ENDPOINT: endpoint, OA_WORKSPACE_ID: 'ws-1', OA_AGENT_NAME: 'Agent_B', OA_WORKSPACE_TOKEN: TOKEN, OA_CHANNEL_NAME: group.channel };
  const put = await child(CLI, ['put-todos', '--args-file', file], env);
  assert.equal(put.code, 0, put.stderr);
  assert.equal(JSON.parse(put.stdout).todos[0].created_by, 'openagents:Agent_B');
  const server = new McpServer({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN, channelName: group.channel });
  const read = await server._dispatch('workspace_get_todos', {});
  assert.equal(read.structuredContent.todos[0].content, 'Run local CSV analysis');
  const putRequest = state.requests.find((r) => r.method === 'PUT');
  assert.equal(putRequest.headers['x-agent-name'], 'Agent_B');
  assert.equal(putRequest.body.source, 'openagents:Agent_B');
  assert.equal(putRequest.body.channel, group.channel);
  for (const todo of [{ content: 'bad status', status: 'done' }, { content: 'wrong owner', status: 'pending', assignee: 'Agent_D' }, { content: 'injected', status: 'pending', source: 'openagents:Agent_A' }]) {
    await assert.rejects(() => callTool(client, 'workspace_put_todos', { channel: group.channel, todos: [todo] }));
  }
  await assert.rejects(() => client.putTodos({ channel: 'readable', todos: [] }), /participant/);
  assert.equal(state.requests.filter((r) => r.method === 'PUT').length, 1);
  const cleared = await server._dispatch('workspace_put_todos', { todos: [] });
  assert.deepEqual(cleared.structuredContent.todos, []);
  const names = buildToolDefs(new Set(['todos'])).map((tool) => tool.name);
  assert.equal(names.includes('workspace_put_todos'), false);
  assert.equal(names.includes('workspace_get_todos'), false);
  state.error = 'http';
  const denied = await server._dispatch('workspace_put_todos', { todos: [] });
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.status, 403);
});

test('concurrent adapter turns carry their exact trigger through the actual CLI without leaking across channels', async (t) => {
  const { endpoint, client, state } = await fixture(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-turn-context-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const groups = await Promise.all([1, 2].map((n) => client.createGroup({ title: `Team ${n}`, participants: ['Agent_A'] })));
  const adapter = new BaseAdapter({ workspaceId: 'ws-1', agentName: 'Agent_B', endpoint, token: TOKEN });
  adapter._log = () => {};
  adapter._schedulePresenceHeartbeat = () => {};
  adapter._handleMessage = async (message) => {
    // Yield so both channel workers overlap before capturing their child env.
    await new Promise((resolve) => setImmediate(resolve));
    const file = path.join(directory, `${message.messageId}.json`);
    fs.writeFileSync(file, JSON.stringify({ channel: message.sessionId, targets: ['Agent_A'], content: 'Please review.' }));
    const result = await child(CLI, ['send-message', '--endpoint', endpoint, '--workspace-id', 'ws-1',
      '--agent-name', 'Agent_B', '--channel-name', message.sessionId, '--args-file', file], adapter.agentEnv);
    assert.equal(result.code, 0, result.stderr);
  };
  await Promise.all(groups.map((group, i) => adapter._channelWorker(group.channel, {
    sessionId: group.channel, messageId: `trigger-${i}`, senderType: 'agent', content: 'Review this',
  })));
  for (const [i, group] of groups.entries()) {
    const posted = state.writes.find((event) => event.type === 'workspace.message.posted' && event.target === `channel/${group.channel}`);
    assert.equal(posted.metadata.in_reply_to, `trigger-${i}`);
  }
  assert.equal(adapter.agentEnv.OA_COLLABORATION_TRIGGER_ID, undefined);
  assert.equal(adapter.agentEnv.OA_COLLABORATION_CHANNEL, undefined);
});

test('MCP receipts retain the triggering turn only when sending to its channel', async (t) => {
  const { ws, client, state } = await fixture(t);
  const group = await client.createGroup({ title: 'MCP team', participants: ['Agent_A'] });
  const server = new McpServer({ wsClient: ws, workspaceId: 'ws-1', agentName: 'Agent_B', token: TOKEN,
    channelName: group.channel, triggerId: 'task-event', triggerChannel: group.channel });
  const delivered = await server._dispatch('workspace_send_message', { channel: group.channel, targets: ['Agent_A'], content: 'Review this.' });
  assert.notEqual(delivered.isError, true);
  assert.equal(state.writes.at(-1).metadata.in_reply_to, 'task-event');
  const reported = await server._dispatch('workspace_send_message', { channel: 'general', targets: [], content: 'User report.' });
  assert.notEqual(reported.isError, true);
  assert.equal(state.writes.at(-1).metadata.in_reply_to, undefined);
});

test('Claude MCP mode grants collaboration writes only in execute mode', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-collaboration-claude-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const mode of ['plan', 'execute']) {
    const adapter = new ClaudeAdapter({ workspaceId: 'ws-1', channelName: 'general',
      agentName: 'Agent_B', token: TOKEN, workingDir: dir, toolMode: 'mcp' });
    adapter._mode = mode;
    const result = withCollaborationTurn({ triggerId: 'claude-task', channel: 'general' }, () => adapter._buildMcpCmd([], 'general'));
    t.after(() => fs.rmSync(result.mcpConfigFile, { force: true }));
    const mcp = JSON.parse(fs.readFileSync(result.mcpConfigFile, 'utf8')).mcpServers['openagents-workspace'];
    assert.equal(mcp.env.OA_COLLABORATION_TRIGGER_ID, 'claude-task');
    assert.equal(mcp.env.OA_COLLABORATION_CHANNEL, 'general');
    assert.ok(result.cmd.includes('mcp__openagents-workspace__workspace_discover_agents'));
    assert.ok(result.cmd.includes('mcp__openagents-workspace__workspace_get_messages'));
    assert.equal(result.cmd.includes('mcp__openagents-workspace__workspace_create_group'), mode === 'execute');
    assert.equal(result.cmd.includes('mcp__openagents-workspace__workspace_send_message'), mode === 'execute');
  }
});

test('the source connector exposes collaboration through its real MCP stdio entry point', { timeout: 15000 }, async (t) => {
  const { endpoint } = await fixture(t);
  const connector = path.resolve(__dirname, '../../agent-connector/bin/agent-connector.js');
  const proc = spawn(process.execPath, [connector, 'mcp-server', '--endpoint', endpoint, '--workspace-id', 'ws-1', '--agent-name', 'Agent_B', '--channel-name', 'general'], {
    env: { ...process.env, OA_WORKSPACE_TOKEN: TOKEN }, windowsHide: true,
  });
  t.after(() => { proc.kill(); });
  const pending = new Map();
  const lines = createInterface({ input: proc.stdout });
  let id = 0;
  lines.on('line', (line) => { const message = JSON.parse(line); const resolve = pending.get(message.id); if (resolve) { pending.delete(message.id); resolve(message); } });
  proc.on('error', (error) => { throw error; });
  function rpc(method, params) {
    return new Promise((resolve) => {
      const key = ++id; pending.set(key, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
    });
  }
  const initialized = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'collaboration-test', version: '1' } });
  assert.ok(initialized.result.capabilities.tools);
  const listing = await rpc('tools/list', {});
  assert.ok(listing.result.tools.some((tool) => tool.name === 'workspace_create_group'));
  const discovery = await rpc('tools/call', { name: 'workspace_discover_agents', arguments: { query: 'CSV', available_only: true } });
  assert.equal(discovery.result.structuredContent.agents[0].agent_name, 'Agent_A');
  const group = await rpc('tools/call', { name: 'workspace_create_group', arguments: { title: 'test', participants: ['Agent_A'] } });
  assert.equal(group.result.structuredContent.channel, 'group-1');
});
