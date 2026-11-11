'use strict';

// Used by test_backend.py against the real FastAPI handlers and test database.
// The specialist reply is test input, not a model-generated result.
const assert = require('node:assert/strict');
const { WorkspaceClient } = require('../../agent-connector/src/workspace-client');
const { CollaborationClient } = require('../src');

async function main() {
  const connection = {
    wsClient: new WorkspaceClient(process.env.OA_WORKSPACE_ENDPOINT),
    workspaceId: process.env.OA_WORKSPACE_ID, token: process.env.OA_WORKSPACE_TOKEN,
    channelName: process.env.OA_CHANNEL_NAME,
  };
  const coordinator = new CollaborationClient({ ...connection, agentName: 'agent-alpha' });
  const reconnect = await connection.wsClient.joinNetwork('agent-beta', connection.token, {
    network: connection.workspaceId, description: 'Changed local default must not replace workspace description',
  });
  assert.equal(reconnect.description_initialized, false);
  const found = await coordinator.discover({ query: 'CSV' });
  assert.ok(found.agents.some((a) => a.agent_name === 'agent-beta'));
  assert.equal(found.agents.find((a) => a.agent_name === 'agent-beta').description, 'CSV chip test analysis');
  const legacy = await connection.wsClient.getAgents(connection.workspaceId, connection.token);
  assert.equal(legacy.find((a) => a.agentName === 'agent-beta').description, 'CSV chip test analysis');
  const card = await coordinator.profile({ agent: 'agent-beta' });
  assert.equal(card.agent_name, 'agent-beta');
  assert.equal(card.description, 'CSV chip test analysis');
  const group = await coordinator.createGroup({ title: 'Collaboration backend test', participants: ['agent-beta'] });
  const task = await coordinator.sendMessage({ channel: group.channel, targets: ['agent-beta'], content: 'Return a test acknowledgment to agent-alpha.' });
  assert.equal(task.status, 'routed');
  const specialist = new CollaborationClient({ ...connection, agentName: 'agent-beta', channelName: group.channel });
  const received = await specialist.getMessages({ channel: group.channel });
  assert.ok(received.messages.some((m) => m.id === task.event_id));
  assert.equal(received.collaboration.coordinator, 'agent-alpha');
  await specialist.sendMessage({ channel: group.channel, targets: ['agent-alpha'], content: 'Specialist contract test acknowledgment.' });
  const fresh = new CollaborationClient({ ...connection, agentName: 'agent-alpha', channelName: group.channel });
  const reply = await fresh.getMessages({ channel: group.channel, after: task.event_id });
  assert.ok(reply.messages.some((m) => m.source === 'openagents:agent-beta'));
  assert.equal(reply.collaboration.origin_channel, connection.channelName);
  const final = await fresh.sendMessage({ channel: reply.collaboration.origin_channel, targets: [], content: 'Backend collaboration flow verified.' });
  const original = await fresh.getMessages({ channel: connection.channelName });
  assert.ok(original.messages.some((m) => m.id === final.event_id));
  process.stdout.write(JSON.stringify({ group: group.channel, private: group.visibility === 'private', origin_recovered: true, returned_to_user_channel: true }));
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
