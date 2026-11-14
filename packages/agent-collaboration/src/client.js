'use strict';

// The transport and ONM event pipeline belong to agent-connector / Workspace.
// This module only adds collaboration operations; it does not register agents,
// run another server, copy files, or implement a second authorization model.
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function agentName(value) {
  const name = text(value, 'agent name').replace(/^openagents:/, '');
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,127}$/u.test(name) || name === '__no_response__') {
    throw new Error('Invalid agent name');
  }
  return name;
}

function channelName(value) {
  const name = text(value, 'channel').replace(/^channel\//, '');
  if (/[\s/\x00-\x1f]/u.test(name)) throw new Error('Invalid conversation name');
  if (name.startsWith('dm:')) {
    const peer = name.slice(3);
    if (peer.startsWith('openagents:')) agentName(peer);
    else if (!/^human:[^,\s/\x00-\x1f]+$/u.test(peer) || peer === 'human:system') throw new Error('Invalid direct conversation peer');
  }
  return name;
}

function names(value, label, { empty = false } = {}) {
  if (!Array.isArray(value) || (!empty && !value.length)) throw new Error(`${label} must be an array${empty ? '' : ' with at least one agent'}`);
  return [...new Set(value.map(agentName))];
}

function unwrap(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Invalid Workspace response');
  if (Object.hasOwn(response, 'code') && response.code !== 0) {
    const error = new Error(response.message || `Workspace rejected operation (${response.code})`);
    error.status = response.code;
    throw error;
  }
  return Object.hasOwn(response, 'data') ? response.data : response;
}

function ready(agent) {
  return agent.status === 'online' && agent.runtime_status !== 'offline'
    && !['working', 'busy'].includes(agent.presence_state)
    && !(agent.busy_channels || []).length && !(agent.queue_depth > 0);
}

function candidate(agent) {
  return {
    agent_name: agentName(agent.address), display_name: agent.display_name,
    agent_type: agent.agent_type, description: agent.description,
    purpose: agent.purpose, enabled_skills: agent.enabled_skills,
    example_requests: agent.example_requests, required_inputs: agent.required_inputs,
    model: agent.model, status: agent.status, presence_state: agent.presence_state,
    runtime_status: agent.runtime_status, queue_depth: agent.queue_depth,
    can_start_thread: agent.can_start_thread, cost_owner: agent.cost_owner,
    available: ready(agent),
  };
}

class CollaborationClient {
  constructor({ wsClient, workspaceId, agentName: caller, token, channelName: origin, sessionId, triggerId, triggerChannel }) {
    this.workspaceId = text(workspaceId, 'workspaceId');
    this.agentName = agentName(caller);
    this.token = text(token, 'workspace token');
    this.channelName = origin;
    this.sessionId = sessionId;
    this.triggerId = triggerId;
    this.triggerChannel = triggerChannel;
    // Never reuse a machine-scoped client's identity for an agent operation.
    this.ws = wsClient.withAgent(this.agentName);
  }

  async _get(path, params) {
    return unwrap(await this.ws._get(`${path}?${new URLSearchParams({ network: this.workspaceId, ...params })}`, this.ws._wsHeaders(this.token)));
  }

  async _discover() {
    const data = await this._get('/v1/discover', {});
    if (!data || !Array.isArray(data.agents) || !Array.isArray(data.channels)) throw new Error('Invalid discovery response: agents and channels are required');
    if (!data.agents.some((a) => a.address === `openagents:${this.agentName}`)) {
      throw new Error('The calling agent must already be registered in this workspace');
    }
    return data;
  }

  async discover({ query = '', available_only = false, usable_only = true } = {}) {
    if (typeof query !== 'string' || typeof available_only !== 'boolean' || typeof usable_only !== 'boolean') throw new Error('Invalid discovery filters');
    const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const data = await this._discover();
    const agents = data.agents.filter((a) => a.address !== `openagents:${this.agentName}`)
      .map(candidate).filter((a) => (!usable_only || a.can_start_thread === true) && (!available_only || a.available))
      .filter((a) => {
        const searchable = JSON.stringify([a.agent_name, a.display_name, a.description, a.purpose,
          a.enabled_skills, a.example_requests, a.agent_type]).toLocaleLowerCase();
        return terms.every((term) => searchable.includes(term));
      });
    return { agents, total: agents.length, selection: 'Choose participants from these candidates; query is a keyword filter, not semantic ranking.' };
  }

  async profile({ agent }) {
    const name = agentName(agent);
    const discovery = await this._discover();
    const advertised = discovery.agents.find((a) => a.address === `openagents:${name}`);
    if (!advertised) throw new Error('Agent is not visible to the calling identity');
    const profile = await this._get(`/v1/agents/${encodeURIComponent(name)}/profile`, {});
    if (!profile || profile.agent_name !== name) throw new Error('Invalid agent profile response');
    // Only the specialist card is exposed, even when an old machine token could
    // read owner-only instructions and knowledge via the underlying endpoint.
    const { agent_name, display_name, agent_type, purpose, example_requests,
      required_inputs, cost_owner, availability, shared_instructions_summary } = profile;
    const publicAvailability = availability && {
      reason: availability.reason, status: availability.status,
      presence_state: availability.presence_state, queue_depth: availability.queue_depth,
      runtime_status: availability.runtime_status,
    };
    return { agent_name, display_name, agent_type, description: advertised.description, purpose, example_requests,
      required_inputs, cost_owner, availability: publicAvailability, shared_instructions_summary };
  }

  _channel(discovery, name, requireMembership = false) {
    const channel = discovery.channels.find((c) => c.address === `channel/${name}`);
    if (!channel) throw new Error('Channel is not visible to the calling agent');
    if (requireMembership && !(channel.participants || []).includes(this.agentName)) {
      throw new Error('The calling agent must be a participant before posting to this channel');
    }
    return channel;
  }

  _messageScope(name) {
    return name.startsWith('dm:')
      ? { conversation: `openagents:${this.agentName},${name.slice(3)}` }
      : { channel: name };
  }

  async _conversation(discovery, name, requireMembership = false) {
    if (!name.startsWith('dm:')) return this._channel(discovery, name, requireMembership);
    const peer = name.slice(3);
    if (peer === `openagents:${this.agentName}`) throw new Error('A direct conversation requires another participant');
    // DMs are native direct events, not discoverable group channels. Require
    // server-visible history involving THIS caller before reading or replying.
    const data = await this._get('/v1/events', { ...this._messageScope(name), type: 'workspace.message.posted', limit: '1', sort: 'desc' });
    if (!data || !Array.isArray(data.events)) throw new Error('Invalid direct conversation response');
    if (!data.events.length) throw new Error('No existing direct conversation is visible to the calling agent');
    return { participants: [this.agentName, ...(peer.startsWith('openagents:') ? [agentName(peer)] : [])] };
  }

  async _event(event) {
    const result = unwrap(await this.ws.sendEvent(this.workspaceId, event, this.token, this.sessionId));
    if (!result || typeof result.id !== 'string') throw new Error('Invalid event receipt; check channel history before retrying');
    return result;
  }

  async _groupContext(name) {
    if (name.startsWith('dm:')) return null;
    const data = await this._get('/v1/events', { channel: name, type: 'network.channel.create', limit: '1', sort: 'asc' });
    if (!data || !Array.isArray(data.events)) throw new Error('Invalid group context response');
    const created = data.events[0];
    const context = created && created.metadata && created.metadata.collaboration;
    // Existing ordinary channels need not have a collaboration origin.
    if (!context) return null;
    if (created.source !== `openagents:${context.coordinator}`) throw new Error('Invalid collaboration coordinator in group context');
    return { coordinator: agentName(context.coordinator), origin_channel: channelName(context.origin_channel) };
  }

  async _humanParticipants(origin, original) {
    const emails = new Set();
    const add = (email) => {
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/u.test(email.trim())) {
        throw new Error('The origin has no supported account email; cannot grant the user access to a private team');
      }
      emails.add(email.trim().toLowerCase());
    };
    if (origin.startsWith('dm:human:')) add(origin.slice('dm:human:'.length));
    else if (original.owner_email) add(original.owner_email);
    // A shared origin may belong to someone other than this task's requester.
    // Read the exact triggering event from the server, not an LLM-provided email.
    if (!origin.startsWith('dm:') && this.triggerId && this.triggerChannel === origin) {
      const data = await this._get('/v1/events', { channel: origin, type: 'workspace.message.posted', sort: 'desc', limit: '500',
        exclude_message_types: 'status,thinking,todos,loading' });
      if (!data || !Array.isArray(data.events)) throw new Error('Invalid origin history response');
      const trigger = data.events.find((event) => event.id === this.triggerId);
      if (!trigger) throw new Error('The triggering event is not visible in the origin history; no group was created');
      if (trigger.source?.startsWith('human:')) {
        const payload = trigger.payload || {}, metadata = trigger.metadata || {};
        add(payload.sender_email || metadata.sender_email || payload.sender_id || trigger.source.slice(6));
      }
    }
    return [...emails];
  }

  async createGroup({ title, participants, origin_channel } = {}) {
    const groupTitle = text(title, 'title');
    const selected = names(participants, 'participants').filter((n) => n !== this.agentName);
    if (!selected.length) throw new Error('Select at least one other agent');
    const origin = channelName(origin_channel || this.channelName);
    const discovery = await this._discover();
    const original = await this._conversation(discovery, origin, true);
    for (const name of selected) {
      const member = discovery.agents.find((a) => a.address === `openagents:${name}`);
      if (!member || member.can_start_thread !== true) throw new Error(`Agent ${name} is not available for a new collaboration with this identity`);
    }
    const members = [this.agentName, ...selected];
    // Identity comes from the server-visible origin, never a tool-supplied email.
    const humans = await this._humanParticipants(origin, original);
    const event = await this._event({
      type: 'network.channel.create', source: `openagents:${this.agentName}`, target: 'core',
      payload: { title: groupTitle, participants: members, master: this.agentName, visibility: 'private',
        human_participants: humans, ...(humans.length ? { owner_email: humans[0] } : {}) },
      metadata: { collaboration: { coordinator: this.agentName, origin_channel: origin } },
    });
    if (!event.metadata || typeof event.metadata.channel_name !== 'string'
      || typeof event.metadata.channel_id !== 'string' || !event.metadata.channel_id || event.metadata.visibility !== 'private') {
      throw new Error(`Group receipt is incomplete (${event.id}); check existing channels before retrying`);
    }
    return { channel: event.metadata.channel_name, channel_id: event.metadata.channel_id,
      event_id: event.id, participants: members, human_participants: humans, visibility: 'private', origin_channel: origin,
      url: this._threadUrl(event.metadata.channel_id) };
  }

  _threadUrl(name) {
    // Canonical frontend route, relative to the current Workspace UI. Never
    // derive a browser origin from the API host or include access credentials.
    return `/${encodeURIComponent(this.workspaceId)}/threads/${encodeURIComponent(name)}`;
  }

  async getBrief({ channel = this.channelName } = {}) {
    const name = channelName(channel);
    if (name.startsWith('dm:')) throw new Error('Native direct conversations do not have a shared work brief');
    this._channel(await this._discover(), name);
    const brief = unwrap(await this.ws.getBrief(this.workspaceId, this.token, name));
    if (!brief || brief.channel !== name) throw new Error('Invalid brief response');
    return { channel: name, brief };
  }

  async updateBrief({ channel = this.channelName, ...fields } = {}) {
    const name = channelName(channel);
    if (name.startsWith('dm:')) throw new Error('Native direct conversations do not have a shared work brief');
    const allowed = ['objective', 'latest_result', 'open_questions', 'next_step', 'owner'];
    if (!Object.keys(fields).length) throw new Error('Pass at least one brief field to update');
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.includes(key)) throw new Error(`Unsupported brief field: ${key}`);
      if (key === 'open_questions' ? !Array.isArray(value) || value.some(q => typeof q !== 'string') : typeof value !== 'string') {
        throw new Error(`Invalid brief field: ${key}`);
      }
    }
    this._channel(await this._discover(), name, true);
    const brief = unwrap(await this.ws.putBrief(this.workspaceId, this.token, name, fields, { source: `openagents:${this.agentName}` }));
    if (!brief || brief.channel !== name) throw new Error('Invalid brief update receipt; inspect the brief before retrying');
    return { channel: name, brief };
  }

  async getTodos({ channel = this.channelName, all = false, agent } = {}) {
    const name = channelName(channel);
    if (typeof all !== 'boolean') throw new Error('Invalid all filter');
    const discovery = await this._discover();
    await this._conversation(discovery, name, true);
    const data = unwrap(await this.ws.getTodos(this.workspaceId, name, this.token, {
      all, ...(agent ? { agent: agentName(agent) } : {}), source: `openagents:${this.agentName}`,
    }));
    if (!data || !Array.isArray(data.todos)) throw new Error('Invalid todos response');
    return { channel: name, todos: data.todos };
  }

  async putTodos({ channel = this.channelName, todos } = {}) {
    const name = channelName(channel);
    if (!Array.isArray(todos)) throw new Error('todos must be an array');
    const discovery = await this._discover();
    const group = await this._conversation(discovery, name, true);
    const items = todos.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).some((key) => !['content', 'status', 'assignee'].includes(key))) throw new Error('Invalid todo item');
      const content = text(item.content, 'todo content');
      if (!['pending', 'in_progress', 'completed'].includes(item.status)) throw new Error('Invalid todo status');
      const assignee = item.assignee ? agentName(item.assignee) : this.agentName;
      if (!(group.participants || []).includes(assignee)) throw new Error('Todo assignee must be a conversation participant');
      return { content, status: item.status, assignee };
    });
    const data = unwrap(await this.ws.putTodos(this.workspaceId, name, this.token, items, { source: `openagents:${this.agentName}` }));
    if (!data || !Array.isArray(data.todos)) throw new Error('Invalid todos receipt; inspect the list before retrying');
    return { channel: name, todos: data.todos };
  }

  async sendMessage({ channel, content, targets = [] } = {}) {
    const name = channelName(channel);
    const body = text(content, 'content');
    const recipients = names(targets, 'targets', { empty: true });
    if (recipients.includes(this.agentName)) throw new Error('Do not dispatch a task to yourself');
    const discovery = await this._discover();
    const group = await this._conversation(discovery, name, true);
    for (const target of recipients) {
      if (!(group.participants || []).includes(target)) throw new Error(`Agent ${target} is not a participant in this channel`);
    }
    const collaboration = await this._groupContext(name);
    // A report without targets is informational. Do not let the LLM router
    // wake another specialist because its name occurs in the report text.
    const routing = recipients.length ? recipients : ['__no_response__'];
    const event = await this._event({
      type: 'workspace.message.posted', source: `openagents:${this.agentName}`,
      target: name.startsWith('dm:') ? name.slice(3) : `channel/${name}`,
      ...(name.startsWith('dm:') ? { visibility: 'direct' } : {}),
      payload: { content: body, message_type: 'chat' },
      metadata: { explicit_targets: routing, target_agents: routing,
        collaboration_tool: 'workspace_send_message',
        ...(this.triggerId && name === this.triggerChannel ? { in_reply_to: this.triggerId } : {}),
        ...(collaboration ? { collaboration } : {}) },
    });
    const routed = event.metadata && event.metadata.target_agents;
    const missing = recipients.filter((target) => !Array.isArray(routed) || !routed.includes(target));
    if (missing.length) {
      const error = new Error('Message was recorded but requested agents were not routed; inspect the receipt before retrying');
      error.receipt = { event_id: event.id, channel: name, unrouted_agents: missing };
      throw error;
    }
    return { event_id: event.id, channel: name, routed_agents: recipients,
      status: recipients.length ? 'routed' : 'recorded',
      execution: 'No task completion is implied; wait for the specialist response.' };
  }

  async getMessages({ channel, after, limit = 20 } = {}) {
    const name = channelName(channel);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
    if (after !== undefined) text(after, 'after');
    const discovery = await this._discover();
    await this._conversation(discovery, name);
    const collaboration = await this._groupContext(name);
    const data = await this._get('/v1/events', { ...this._messageScope(name), type: 'workspace.message.posted',
      limit: String(limit), sort: after ? 'asc' : 'desc', exclude_message_types: 'status,thinking,todos,loading',
      ...(after ? { after } : {}) });
    if (!data || !Array.isArray(data.events)) throw new Error('Invalid messages response: events are required');
    const events = after ? data.events : data.events.slice().reverse();
    const messages = events.map((e) => ({ id: e.id, source: e.source, timestamp: e.timestamp,
      content: e.payload && e.payload.content, attachments: e.payload && e.payload.attachments }));
    return { channel: name, ...(!name.startsWith('dm:') ? { url: this._threadUrl(name) } : {}),
      collaboration, messages, next_after: messages.length ? messages[messages.length - 1].id : (after || null) };
  }
}

module.exports = { CollaborationClient };
