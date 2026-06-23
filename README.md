# OpenCode Session Status Prefix

OpenCode plugin that keeps session titles prefixed with live task status like `[process]`, `[pending]`, `[done]`, `[pushed]`, `[stoped]`, and `[closed]`.

It is useful when you run many OpenCode sessions in parallel and want to scan the session list without opening every chat.

## Statuses

| Prefix | Meaning |
| --- | --- |
| `[pending]` | The session is waiting for user input, approval, or a blocking decision. |
| `[process]` | The session is actively working. |
| `[pushed]` | The agent successfully ran `git push`. |
| `[done]` | The requested work is complete and no user action is required. |
| `[stoped]` | Execution was manually stopped by the user. |
| `[closed]` | The user explicitly accepted or closed the task. |

The plugin preserves the existing session title. For example:

```text
Auth refactor
[process] Auth refactor
[done] Auth refactor
```

It also avoids replacing a not-yet-generated OpenCode title with `[status] New session`. If OpenCode has not produced a real title yet, the plugin delays the prefix and reapplies it after the session title is updated.

Manual renames are preserved. If you rename a session in OpenCode Desktop, the plugin treats the new title as the base title and reapplies the current prefix to it.

## What It Does

The plugin listens to OpenCode session events and updates the current session title through OpenCode's session API.

Automatic status changes:

- `session.status: busy` or `retry` -> `[process]`
- manual session interruption / stop button -> `[stoped]`
- `permission.asked` -> `[pending]`
- `question.asked` -> `[pending]`
- `session.error` -> `[pending]`
- `session.idle` -> `[done]`, unless the session is held in `[pending]`, `[pushed]`, `[stoped]`, or `[closed]`
- successful `git push` via the bash tool -> `[pushed]`

Manual semantic status changes:

- The plugin adds a `session_status_prefix` tool.
- Global instructions tell the agent when to call that tool.
- `[closed]` is only set when the user explicitly asks to close or accept the task.

## Requirements

- OpenCode 1.17 or newer
- Node.js 18 or newer for the installer
- `npm` is recommended so the installer can install `@opencode-ai/plugin` immediately

## Install

One command:

```bash
curl -fsSL https://raw.githubusercontent.com/mkrtc/opencode-session-status-prefix/main/install.sh | bash
```

Then fully restart OpenCode Desktop or your OpenCode TUI.

The installer:

- copies the plugin into `~/.config/opencode/plugins/session-status-prefix.mjs`
- copies agent instructions into `~/.config/opencode/session-status-prefix.instructions.md`
- adds the plugin file URL to your global `opencode.jsonc`
- adds the instruction file to your global `instructions`
- adds `@opencode-ai/plugin` to `~/.config/opencode/package.json`
- creates a timestamped backup before rewriting an existing config file

### Install From a Clone

```bash
git clone git@github.com:mkrtc/opencode-session-status-prefix.git
cd opencode-session-status-prefix
node install.mjs
```

Use a custom config directory:

```bash
node install.mjs --config-dir=/path/to/opencode-config
```

Skip `npm install`:

```bash
node install.mjs --skip-install
```

## Manual Install

Copy the plugin and instructions:

```bash
mkdir -p ~/.config/opencode/plugins
cp src/session-status-prefix.js ~/.config/opencode/plugins/session-status-prefix.mjs
cp session-status-prefix.instructions.md ~/.config/opencode/session-status-prefix.instructions.md
```

Add the plugin and instructions to `~/.config/opencode/opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///home/YOU/.config/opencode/plugins/session-status-prefix.mjs"
  ],
  "instructions": [
    "/home/YOU/.config/opencode/session-status-prefix.instructions.md"
  ]
}
```

Add the plugin dependency to `~/.config/opencode/package.json`:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.17.9"
  }
}
```

Then restart OpenCode.

## Agent Instructions

The installer registers `session-status-prefix.instructions.md` as a global OpenCode instruction file. It tells the agent:

- use `session_status_prefix` when changing semantic status;
- set `[process]` before non-trivial work;
- set `[pending]` before blocking questions;
- set `[pushed]` only after a successful push;
- set `[done]` only when the task is complete;
- set `[stoped]` only when execution was manually stopped;
- set `[closed]` only when the user explicitly closes or accepts the task.

## Troubleshooting

Check that OpenCode sees the plugin:

```bash
opencode debug config
```

Look for:

```text
file:///.../.config/opencode/plugins/session-status-prefix.mjs
```

If OpenCode Desktop behaves strangely after install:

1. Fully quit OpenCode Desktop.
2. Check `~/.config/opencode/opencode.jsonc`.
3. Temporarily remove the plugin entry.
4. Restart OpenCode Desktop.

OpenCode also creates config backups during install:

```text
~/.config/opencode/opencode.jsonc.bak.<timestamp>
```

## Uninstall

Remove these entries from `~/.config/opencode/opencode.jsonc`:

```json
"file:///home/YOU/.config/opencode/plugins/session-status-prefix.mjs"
"/home/YOU/.config/opencode/session-status-prefix.instructions.md"
```

Then remove the files:

```bash
rm -f ~/.config/opencode/plugins/session-status-prefix.mjs
rm -f ~/.config/opencode/session-status-prefix.instructions.md
```

Restart OpenCode.

## Notes

This is a plugin-only solution. It does not patch OpenCode Desktop UI directly. It works by updating session titles, so any OpenCode client that displays session titles can show the status prefix.
