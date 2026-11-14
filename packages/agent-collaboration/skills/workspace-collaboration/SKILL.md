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
3. Create a private group with the selected agents. The coordinator and verified origin owner are included automatically; do not provide or guess an owner email. Retain the returned channel, origin_channel, and url. Immediately post `[查看协作过程](RETURNED_URL)` in the original conversation so the user can observe delegation and replies. Group creation does not dispatch work or copy the original conversation's history.
4. Send an explicit task to named group members. Include the necessary context, expected output, and coordinator name so specialists can route substantive results back. Only share task-relevant context.
5. A recorded or routed message is not an executed task. Use actual replies as evidence. Read subsequent replies using next_after; yield after handing off rather than busy-polling. Report offline, denied, unrouted, and failed operations explicitly.
6. Return the final findings and the group link to the original user channel. Leave targets empty for an informational report so mentioning an agent in the text does not wake it again. Do not dispatch acknowledgments or thanks.

Use workspace_put_todos / workspace_get_todos (CLI: put-todos / get-todos) for planning. Update only your own list, assigning work only to participants. Use the collaboration tools for discovery, profiles, group creation, messages, history, and planning. Do not replace them with raw HTTP/curl, edit connector/other agents' configuration, or use another agent's local directory to work around a missing capability. If an operation fails, report the error instead of bypassing it. Generic REST instructions for other Workspace resources do not override this rule.

Specialists use their own host-local tools, knowledge, and large files. Exchange small summaries or explicitly authorized resources; do not automatically upload source data to Workspace. Shared message content is stored by Workspace.

Keep the shared work brief current with workspace_update_brief (CLI: update-brief); read it with workspace_get_brief (CLI: get-brief). Pass channel to select the group or the original user thread. Update objective, latest_result, open_questions, next_step, and owner as needed; omitted fields stay unchanged, empty strings and [] clear them. Use owner (openagents:<agent> or human:<email>), not next_owner. Do not supply network, source, credentials, or call the brief HTTP endpoint yourself. Native direct conversations have no shared brief; report that limitation rather than inventing a group.

For MCP, use workspace_discover_agents, workspace_get_agent_profile, workspace_create_group, workspace_send_message, and workspace_get_messages. For skill-driven runtimes, use the equivalent CLI operations documented in the current generated Workspace skill's Agent Collaboration section. The CLI receives credentials from the child environment, not from business arguments.

Server-side authorization remains authoritative. Candidate visibility is not proof of permission to start a new thread. The tools recheck can_start_thread before creation, but do not establish a new user-delegation authorization system.
