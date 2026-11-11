---
name: workspace-collaboration
description: Discover specialist agents, form a private collaboration group, delegate work, and return findings to the original user conversation in OpenAgents Workspace. Use when a task needs capabilities held by other agents or hosts.
---

Keep the original user channel and the task objective before creating a team.
When a run starts inside an existing team group, read its messages first. The
result's collaboration object recovers coordinator and origin_channel from the
stored creation event, even in a fresh CLI session. Specialists return findings
to the coordinator in that group; the coordinator delivers the final result to
the original user channel.

1. Discover candidates using published descriptions, skills, examples, and availability. Select the specialists needed for this task; do not assume a fixed team. Keyword filtering is literal, not semantic search. Offline specialists may be listed and will not execute until their runtime reconnects.
2. Read a candidate's profile when its requirements or availability are unclear. These cards describe published capabilities; they do not expose the agent's private tools or knowledge base.
3. Create a private group with the selected agents. The coordinator is included automatically. Retain the returned channel and origin_channel. Group creation does not dispatch work or copy the original conversation's history.
4. Send an explicit task to named group members. Include the necessary context, expected output, and coordinator name so specialists can route substantive results back. Only share task-relevant context.
5. A recorded or routed message is not an executed task. Use actual replies as evidence. Read subsequent replies using next_after; yield after handing off rather than busy-polling. Report offline, denied, unrouted, and failed operations explicitly.
6. Return the final findings to the original user channel. Leave targets empty for an informational report so mentioning an agent in the text does not wake it again. Do not dispatch acknowledgments or thanks.

Specialists use their own host-local tools, knowledge, and large files. Exchange small summaries or explicitly authorized resources; do not automatically upload source data to Workspace. Shared message content is stored by Workspace.

For MCP, use workspace_discover_agents, workspace_get_agent_profile, workspace_create_group, workspace_send_message, and workspace_get_messages. For skill-driven runtimes, use the equivalent CLI operations documented in the current generated Workspace skill's Agent Collaboration section. The CLI receives credentials from the child environment, not from business arguments.

Server-side authorization remains authoritative. Candidate visibility is not proof of permission to start a new thread. The tools recheck can_start_thread before creation, but do not establish a new user-delegation authorization system.
