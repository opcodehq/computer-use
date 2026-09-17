Test the actual Zuse (Beta) application's terminal using ONLY our jev MCP tools.
The user is working concurrently. Never activate/raise the app, move the real
cursor, use global keyboard events, change Spaces, or use a foreground fallback.
The driver defaults to app/window-directed background delivery. It may refuse
unsupported actions; do not bypass a refusal.

Goal: open a NEW disposable terminal panel/session, run exactly
`echo JEV_TEST_BACKGROUND_917`, independently verify the output line
`JEV_TEST_BACKGROUND_917`, then close ONLY the terminal session/panel created
by this test. Do not start a coding agent, send chats, publish, alter files,
change credentials, or terminate any existing terminal process. Use an existing
local project only as context; never modify its files. If creating the terminal
would start billable remote compute, mark blocked instead.

First list windows and bind observation to the correct windowId. Inspect the
current app state, including whether a terminal already exists. Use desktop_act
with Jev for the first narrow navigation action. If Jev is uncertain, the host
may choose an exact observed ref through desktop_execute. If AXPress is
acknowledged but the desired UI is absent, observe/wait before deciding whether
a background desktop_click fallback is justified. Do not blindly replay input.

Use fresh refs and snapshotId from the most recent tool response. Partial trees
do not establish missing controls; increase nodeLimit or inspect another listed
window. For input, first background-click the observed terminal input field,
observe and require it to be focused, then desktop_type exact command text and
desktop_key Enter into that exact ref. Never type into an existing terminal
containing pending input or an active process. A key dispatch acknowledgement
is not proof of command execution.

Verify the exact output line using desktop_wait exactLine matching and inspect
its context: do not mistake the typed command or a field containing the command
for shell output. Record pass/fail/blocked for open/type/execute/output/close,
with concrete observed evidence. If blocked, explain the exact missing capability
and keep the report truthful. No fixed task-step limit; stop when all steps are
verified or further attempts cannot safely add evidence. Finish with a compact
report and counts of Jev, semantic, pointer and keyboard calls.
