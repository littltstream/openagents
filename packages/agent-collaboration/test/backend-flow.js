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
  await coordinator.putTodos({ todos: [{ content: 'Discover a specialist', status: 'in_progress' }] });
  if (connection.channelName.startsWith('dm:')) {
    await assert.rejects(() => coordinator.getMessages({ channel: 'dm:human:unrelated@example.test' }), /direct conversation/i);
  }
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
  assert.ok(group.url.endsWith(`/threads/${group.channel_id}`));
  assert.equal((await coordinator._get(`/v1/thread-links/${group.channel_id}`, {})).session_id, group.channel);
  await coordinator.putTodos({ channel: group.channel, todos: [{ content: 'Analyze the specialist data', status: 'pending', assignee: 'agent-beta' }] });
  assert.equal((await coordinator.getTodos({ channel: group.channel })).todos[0].assignee, 'agent-beta');
  await coordinator.updateBrief({ channel: group.channel, objective: 'Specialist analysis', owner: 'openagents:agent-beta', open_questions: ['Await the result'] });
  const brief = await coordinator.updateBrief({ channel: group.channel, latest_result: 'Task delegated', open_questions: [] });
  assert.equal(brief.brief.objective, 'Specialist analysis');
  assert.equal(brief.brief.updated_by, 'openagents:agent-alpha');
  assert.deepEqual((await coordinator.getBrief({ channel: group.channel })).brief.open_questions, []);
  const task = await coordinator.sendMessage({ channel: group.channel, targets: ['agent-beta'], content: 'Return a test acknowledgment to agent-alpha.' });
  assert.equal(task.status, 'routed');
  const specialist = new CollaborationClient({ ...connection, agentName: 'agent-beta', channelName: group.channel,
    triggerId: task.event_id, triggerChannel: group.channel });
  const received = await specialist.getMessages({ channel: group.channel });
  assert.ok(received.messages.some((m) => m.id === task.event_id));
  assert.equal(received.collaboration.coordinator, 'agent-alpha');
  const delivered = await specialist.sendMessage({ channel: group.channel, targets: ['agent-alpha'], content: 'Specialist contract test acknowledgment.' });
  const summary = await connection.wsClient.withAgent('agent-beta').sendMessage(connection.workspaceId, group.channel,
    connection.token, '@agent-alpha I have sent the result.', { senderName: 'agent-beta',
      metadata: { status_kind: 'completed', in_reply_to: task.event_id } });
  assert.deepEqual(summary.metadata.target_agents, ['__no_response__']);
  assert.equal(summary.metadata.collaboration_delivery_event_id, delivered.event_id);
  const fresh = new CollaborationClient({ ...connection, agentName: 'agent-alpha', channelName: group.channel });
  const reply = await fresh.getMessages({ channel: group.channel, after: task.event_id });
  assert.ok(reply.messages.some((m) => m.source === 'openagents:agent-beta'));
  assert.equal(reply.collaboration.origin_channel, connection.channelName);
  const final = await fresh.sendMessage({ channel: reply.collaboration.origin_channel, targets: [], content: 'Backend collaboration flow verified.' });
  const original = await fresh.getMessages({ channel: connection.channelName });
  assert.ok(original.messages.some((m) => m.id === final.event_id));
  process.stdout.write(JSON.stringify({ group: group.channel, private: group.visibility === 'private', origin_recovered: true, returned_to_user_channel: true, final_event_id: final.event_id, human_participants: group.human_participants }));
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
