'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { Config } = require('../../agent-connector/src/config');
const { AgentConnector } = require('../../agent-connector/src');
const { WorkspaceClient } = require('../../agent-connector/src/workspace-client');
const BaseAdapter = require('../../agent-connector/src/adapters/base');
const { McpServer } = require('../../agent-connector/src/mcp-server');
const { Daemon } = require('../../agent-connector/src/daemon');
const { EnvManager } = require('../../agent-connector/src/env');
const { Registry } = require('../../agent-connector/src/registry');

function temporaryConfig(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-description-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('local capability descriptions round-trip multiline Unicode, quotes, and Windows paths', (t) => {
  const config = new Config(temporaryConfig(t));
  const description = '分析芯片 CSV: "PASS/FAIL"\n只在本机处理 C:\\new\\tests，不上传原始文件。';
  config.addAgent({ name: 'specialist', type: 'codex', description });
  config.addAgent({ name: 'plain', type: 'codex', path: 'D:\\important\\new' });
  assert.equal(config.getAgent('specialist').description, description);
  assert.equal(config.getAgent('plain').path, 'D:\\important\\new');
  assert.equal(Object.hasOwn(config.getAgent('plain'), 'description'), false);
  config.updateAgent('specialist', { role: 'worker', description: undefined });
  assert.equal(config.getAgent('specialist').description, description);
  config.updateAgent('specialist', { description: '' });
  assert.equal(config.getAgent('specialist').description, '');
});

test('library creation publishes a local default without installing skills or mutating other agents', (t) => {
  const connector = new AgentConnector({ configDir: temporaryConfig(t) });
  connector.addAgent({ name: 'chip', type: 'codex', description: '  CSV specialist  ' });
  connector.addAgent({ name: 'other', type: 'codex' });
  assert.equal(connector.listAgents().find((a) => a.name === 'chip').description, 'CSV specialist');
  assert.equal(connector.config.getAgent('other').description, undefined);
  assert.throws(() => connector.addAgent({ name: 'invalid', type: 'codex', description: true }), /must be a string/);
  assert.equal(connector.config.getAgent('invalid'), null);
});

test('agn create accepts --description and rejects a missing argument without writing an agent', async (t) => {
  const dir = temporaryConfig(t);
  const cli = path.resolve(__dirname, '../../agent-connector/bin/agent-connector.js');
  const env = { ...process.env, HOME: dir, USERPROFILE: dir, OPENAGENTS_SKIP_UPDATE_CHECK: '1' };
  const description = 'CSV 芯片分析\n不上传源数据';
  await exec(process.execPath, [cli, 'create', 'chip', '--type', 'codex', '--description', description, '--config', dir], { env, timeout: 15000 });
  const config = new Config(dir);
  assert.equal(config.getAgent('chip').description, description);
  await assert.rejects(() => exec(process.execPath, [cli, 'create', 'bad', '--type', 'codex', '--config', dir, '--description'], { env, timeout: 15000 }));
  assert.equal(config.getAgent('bad'), null);
});

test('adapter join carries the default and detects servers that would silently ignore it', async (t) => {
  const requests = [];
  let supportsDescription = true;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: 0, data: { session_id: 'session-test', ...(supportsDescription ? { description_initialized: true } : {}) } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const adapter = new BaseAdapter({ workspaceId: 'ws', channelName: 'general', agentName: 'chip',
    endpoint, token: 'fixture-token', description: 'CSV specialist' });
  adapter._log = () => {};
  assert.equal(await adapter._joinWorkspace(), true);
  assert.equal(requests[0].description, 'CSV specialist');
  assert.equal(requests[0].agent_name, 'chip');
  assert.equal(adapter._sessionId, 'session-test');
  supportsDescription = false;
  const client = new WorkspaceClient(endpoint);
  await assert.rejects(() => client.joinNetwork('chip', 'fixture-token', { network: 'ws', description: 'CSV' }), /update the backend/);
  // Existing clients without the new optional field keep their join contract.
  assert.equal((await client.joinNetwork('chip', 'fixture-token', { network: 'ws' })).session_id, 'session-test');
  assert.equal(Object.hasOwn(requests[2], 'description'), false);
});

test('the existing workspace_get_agents MCP tool exposes the advertised description and identity', async () => {
  const server = new McpServer({ workspaceId: 'ws', agentName: 'coordinator', channelName: 'general', token: 'fixture-token',
    wsClient: { getAgents: async () => [{ agentName: 'chip', agentType: 'codex', status: 'online', description: 'CSV chip specialist' }] } });
  const result = await server._dispatch('workspace_get_agents', {});
  assert.match(result.content[0].text, /chip \(codex\)/);
  assert.match(result.content[0].text, /CSV chip specialist/);
  assert.equal(result.content[0].text.includes('undefined'), false);
});

test('remote creation and working-directory recreation preserve the advertised local default', async (t) => {
  const dir = temporaryConfig(t);
  const config = new Config(dir);
  const daemon = new Daemon(config, new EnvManager(dir), new Registry(dir));
  const node = { node_id: 'n1', workspace_id: 'ws-1', workspace_slug: 'workspace', token: 'fixture-token', endpoint: 'https://workspace.example' };
  let result;
  daemon._nodeClients.set(node.node_id, { nodeCommandResult: async (_id, _token, value) => { result = value; } });
  daemon._probeAgent = async () => null;
  daemon._nodeHeartbeat = async () => {};
  daemon._askCliModels = () => {};
  daemon._runAgn = async (args) => {
    if (args[0] === 'create') {
      const index = args.indexOf('--description');
      config.addAgent({ name: args[1], type: args[3], path: args[args.indexOf('--path') + 1],
        ...(index >= 0 ? { description: args[index + 1] } : {}) });
    }
    if (args[0] === 'remove') config.removeAgent(args[1]);
    if (args[0] === 'connect') config.setAgentNetwork(args[1], node.workspace_slug);
    return { code: 0, stdout: '', stderr: '' };
  };
  const description = 'CSV specialist\nKeep raw files on this host.';
  const oldDir = path.join(dir, 'old');
  const newDir = path.join(dir, 'new');
  await daemon._runNodeCommand(node, { commandId: 'create', action: 'create_agent',
    args: { name: 'chip', type: 'codex', workingDir: oldDir, description } });
  assert.equal(result.ok, true, result.message);
  assert.equal(config.getAgent('chip').description, description);
  await daemon._runNodeCommand(node, { commandId: 'move', action: 'configure_agent',
    args: { name: 'chip', type: 'codex', workingDir: newDir, currentWorkingDir: oldDir } });
  assert.equal(result.ok, true, result.message);
  assert.equal(config.getAgent('chip').path, newDir);
  assert.equal(config.getAgent('chip').description, description);
});
