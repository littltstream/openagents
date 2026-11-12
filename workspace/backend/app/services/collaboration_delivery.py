"""Keep adapter summaries informational after an explicit tool handoff."""
from sqlalchemy import select
from app.models import EventRecord


def delivered_collaboration_reply(db, workspace, event):
    metadata = event.metadata or {}
    trigger_id = metadata.get('in_reply_to')
    if (not trigger_id or metadata.get('status_kind') != 'completed'
            or not (event.source or '').startswith('openagents:')
            or (event.payload or {}).get('message_type', 'chat') != 'chat'):
        return None
    # Only a receipt from this sender, channel and exact triggering event
    # counts. Timestamp windows would confuse queued or concurrent requests.
    receipts = db.execute(select(EventRecord).where(
        EventRecord.network_id == workspace.id,
        EventRecord.type == 'workspace.message.posted',
        EventRecord.source == event.source,
        EventRecord.target == event.target,
        EventRecord.metadata_['collaboration_tool'].as_string() == 'workspace_send_message',
        EventRecord.metadata_['in_reply_to'].as_string() == trigger_id,
    ).order_by(EventRecord.timestamp.desc(), EventRecord.id.desc())).scalars()
    for receipt in receipts:
        meta = receipt.metadata_ or {}
        targets = meta.get('target_agents') or []
        explicit = meta.get('explicit_targets') or []
        if any(target != '__no_response__' and target in explicit for target in targets):
            return receipt.id
    return None
