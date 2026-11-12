"""A tool dispatch and its adapter's final summary must not wake a peer twice."""
import asyncio
from unittest.mock import AsyncMock

import pytest
from app.config import config
from app.models import EventRecord
from app.mods.workspace_mod import _handle_message_posted
from openagents.core.onm_mods import PipelineContext
from tests.test_llm_router import _make_event
from tests.test_response_mode import multi_agent_workspace, router_workspace, isolated_router  # noqa: F401


def route(db, setup, event):
    ws = setup['workspace']
    ctx = PipelineContext(network_id=ws.id, agent_address=event.source, db=db, workspace=ws)
    return asyncio.run(_handle_message_posted(event, ctx)).metadata['target_agents']


@pytest.fixture
def delivery(db, multi_agent_workspace, monkeypatch):
    setup = multi_agent_workspace
    ws, ch = setup['workspace'], setup['channel']
    trigger = EventRecord(id='assigned-task', network_id=ws.id, type='workspace.message.posted',
        source='openagents:agent-master', target=f'channel/{ch.name}', timestamp=100,
        payload={'content': 'Analyze the results'}, metadata_={'target_agents': ['agent-worker']})
    receipt = EventRecord(id='tool-receipt', network_id=ws.id, type='workspace.message.posted',
        source='openagents:agent-worker', target=trigger.target, timestamp=200,
        payload={'content': 'Analysis result', 'message_type': 'chat'},
        metadata_={'collaboration_tool': 'workspace_send_message', 'in_reply_to': trigger.id,
            'explicit_targets': ['agent-master'], 'target_agents': ['agent-master']})
    db.add_all([trigger, receipt]); db.flush()
    router = AsyncMock(return_value=['agent-master'])
    monkeypatch.setattr('app.mods.workspace_mod._route_with_llm', router)
    event = _make_event('openagents:agent-worker', trigger.target, '@agent-master I sent the result.')
    event.timestamp = 300
    event.metadata.update(status_kind='completed', in_reply_to=trigger.id)
    return setup, trigger, receipt, event, router


@pytest.mark.parametrize('completion_routing', [False, True])
def test_summary_after_delivered_tool_result_is_visible_but_informational(db, delivery, monkeypatch, completion_routing):
    setup, trigger, receipt, event, router = delivery
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_ENABLED', completion_routing)
    assert route(db, setup, event) == ['__no_response__']
    assert event.payload['content'] == '@agent-master I sent the result.'
    assert event.metadata['collaboration_delivery_event_id'] == receipt.id
    router.assert_not_called()


@pytest.mark.parametrize('change', ['old', 'other_source', 'other_channel', 'unrouted', 'not_a_tool', 'next_turn'])
def test_unrelated_or_unsent_tool_messages_do_not_suppress_the_normal_answer(db, delivery, monkeypatch, change):
    setup, trigger, receipt, event, router = delivery
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_ENABLED', False)
    if change == 'old': receipt.metadata_ = {**receipt.metadata_, 'in_reply_to': 'older-task'}
    if change == 'other_source': receipt.source = 'openagents:agent-master'
    if change == 'other_channel': receipt.target = 'channel/unrelated'
    if change == 'unrouted': receipt.metadata_ = {**receipt.metadata_, 'target_agents': ['__no_response__']}
    if change == 'not_a_tool': receipt.metadata_ = {'target_agents': ['agent-master']}
    if change == 'next_turn': event.metadata['in_reply_to'] = 'queued-task'
    db.flush()
    assert route(db, setup, event) == ['agent-master']
    assert 'collaboration_delivery_event_id' not in event.metadata


def test_tool_dispatch_itself_is_not_suppressed(db, delivery, monkeypatch):
    setup, trigger, receipt, event, router = delivery
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_ENABLED', False)
    event.metadata = dict(receipt.metadata_)
    assert route(db, setup, event) == ['agent-master']


def test_final_answer_without_a_correlated_trigger_is_not_suppressed(db, delivery, monkeypatch):
    setup, trigger, receipt, event, router = delivery
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_ENABLED', False)
    event.metadata.pop('in_reply_to')
    assert route(db, setup, event) == ['agent-master']
