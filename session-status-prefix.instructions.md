# Session Status Prefix Protocol

Keep the current OpenCode session title prefixed with exactly one status.

Allowed status prefixes:
- `[pending]`: waiting for user input, approval, or a blocking decision.
- `[process]`: actively working.
- `[pushed]`: changes were successfully pushed to git.
- `[done]`: requested work is complete and no user action is required.
- `[closed]`: the user explicitly accepted or closed the task.

Rules:
- Use the `session_status_prefix` tool when you intentionally change the semantic task state.
- Set `[process]` before starting non-trivial work.
- Set `[pending]` before asking a blocking question.
- Set `[pushed]` only after a successful `git push`.
- Set `[done]` only when the requested task is actually complete.
- Set `[closed]` only when the user explicitly asks to close or accept the task.
- Preserve the existing title text after the prefix.
- Do not write status-only messages in chat as a substitute for using the tool.
