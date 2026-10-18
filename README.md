# claude-trajectory

A Claude Code mod that shows the trajectory of a session in a pane, in the style of DeepSeek Hermes' Trajectory view: every system prompt, user prompt, injected context, assistant reply, thinking block and tool call on one timeline.

```
Duration  Turns  Calls   42 rows                  ▲ 12 earlier  latest ▼
[Search                                                      ]
Input  ⣿⣿ ⣿    ⣿
Model    ⣿⣿ ⣿⣿ ⣿⣿
Tools      ⣿⣿⣿ ⣿⣿⣿⣿
Turn 2   ASSISTANT Let me list the config files first.
▶             TOOL Bash {"command":"ls -la"} 1.2s → package.json
TOOL Bash · Turn 2 · 01:12:03 · 1.2s · 3 lines · ≈8 tok   y: copy  k: prev  j: next  p: ▲  n: ▼
{"command":"ls -la"}

→ package.json
3 turns · 12 steps · 30 calls · 2.1M tok · cache hit 96% · 4.2m
```

## Install

At the prompt of a terminal session:

```
/plugin install trajectory --marketplace him0/claude-trajectory
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install trajectory --marketplace him0/claude-trajectory
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `him0/claude-trajectory`, then Add plugin.

## Use

Run `/trajectory` to open the pane.

- **Top half**: one row per event, with a colored badge (`SYSTEM`, `USER`, `CONTEXT`, `ASSISTANT`, `THINKING`, `TOOL`). Tool rows show the input, how long the call took and its result.
- **Minimap**: Input / Model / Tools lanes, laid out by **Duration** (`d`, wall-clock), **Turns** (`t`) or **Calls** (`c`, one slot per row).
- **Search**: filters rows by kind, tool name, text or result.
- **Bottom half**: click a row to read it whole: the system prompt's sections, a full prompt, a tool call's input and result. The header shows its turn, time, duration, line count and an estimated token count.

Keys, once the pane has focus (`ctrl+x tab`):

| Key | Action |
| --- | --- |
| `k` / `j` | previous / next row |
| `p` / `n` | scroll the detail up / down |
| `g` | back to the newest rows |
| `y` | copy the selected row to the clipboard |
| `d` / `t` / `c` | minimap by duration / turns / calls |

## Notes

- Only the main conversation is recorded; subagents' rows are left out.
- The last 1000 rows are kept; each row's text up to 20,000 characters (80,000 for the system prompt).
- Token counts in the detail header are a local estimate (about 4 ASCII characters, or 1 other character, per token).
- `/clear` starts the timeline over.
