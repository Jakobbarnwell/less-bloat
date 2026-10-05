# less-bloat

Kill the bloat in Claude Code's system prompt, without turning a single tool off.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jakobbarnwell)

| Tokens to start a session | Without | With less-bloat |
| --- | --- | --- |
| CLI, no MCP servers | 15,565 | 10,770 |
| Desktop app, with MCP servers and connectors | 63,712 | 33,983 |

Measured from the API's usage report. The desktop numbers are from one setup, on Claude Code 2.1.286;
yours depend on what you have connected.

Want to see it work? Ask Claude:

> Measure how many tokens less-bloat saves: compare a one-prompt `claude -p` run with less-bloat
> enabled and with it disabled.

## How it works

1. Claude Code sends some tools in full: their name, description and schema are part of every
   system prompt, whether Claude uses them or not.
2. The other tools, including most MCP servers', are name-only by design: listed by name. When
   Claude wants to use one, it fetches the full description with ToolSearch.
3. less-bloat makes the rarely needed ones name-only too, built-in or MCP, including the ones that
   ask Claude Code for their full description. Only the everyday ones stay in full.

## Modes

- **Default** keeps the full description for Bash, Read, Edit, Write, Glob, Grep, Agent, Skill,
  AskUserQuestion and SendUserFile, plus the desktop app's chapter, side-task and widget tools when
  you're in the app, and a project thread's reply tools.
- **Custom** is your own list. Run `/less-bloat` to open a pane with your tools, each MCP server's
  as one row, showing which are in full and why the recommended ones are. Switch any of them and
  save, or ask Claude to. Your choice holds for every session, CLI and desktop alike.

A change applies from your next conversation: a new session or `/clear`. The tools sit at the start
of every request, so changing them mid-conversation would throw away the prompt cache.

Claude reaches for name-only tools on its own when their names say what they're for. Keep a tool in
full when its name doesn't, as Agent's doesn't say when to delegate. ToolSearch always stays in full,
since Claude fetches all the others with it.

## Why would I use this

- **Fewer tokens every turn.** The system prompt goes out with every request. Cutting it makes each
  turn cheaper, stretches your usage limits and leaves more room before compaction.
- **Nothing is turned off.** Deny rules and `disable*` settings remove tools, and settings can't make
  a built-in tool or the desktop app's own servers name-only. Here every tool still works: Claude
  fetches its full description with one ToolSearch call the first time it needs it.
- **It goes with removing what you never use.** Deny or disable the tools you never want, as Matt
  Pocock's [article](https://www.aihero.dev/how-to-kill-the-bloat-in-claude-codes-system-prompt)
  shows, and less-bloat makes the rarely needed rest name-only.
- **No setup.** The default works as is.
- **Small enough to read.** A mod can read and write files, run commands and go online as you, so
  check what you install. less-bloat is under 800 lines of TypeScript in `hooks/`, and does none of
  these. (`scripts/check.py` is a test you run yourself; the plugin never runs it.) It keeps your
  choices, and which tools it has told you about, in Claude Code's own plugin store.

## FAQ

**How do I see which tools are in full?** Run `/less-bloat`. Its pane shows what new conversations
get. To see this conversation's, ask Claude. Where the pane can't open, such as in `claude -p` or
without ToolSearch, `/less-bloat` prints the list instead.

**Does a name-only tool still cost tokens?** Only its name, in Claude Code's list of name-only tools.
Its description and schema come in when Claude fetches them.

**Will I know what it changed?** Your first session shows a toast with how many tools less-bloat
made name-only that Claude Code would put in full, and a line in the transcript saying where they're
from. After that, you get one only for a new tool, such as a newly added MCP server's, once. A
`claude -p` run has nowhere to show it, so it waits for a session that does. `/less-bloat` lists
them all, and you can switch any of them there.

**What happens when I add an MCP server?** Most servers' tools are name-only in Claude Code anyway,
so nothing changes. One that asks for its full description gets name-only too, with a notice. A
server that connects after your first message stays as Claude Code placed it until your next
conversation.

**Does `/clear` reset less-bloat?** The new conversation starts fresh. less-bloat keeps each
earlier conversation's placements in memory until Claude Code exits, so `/resume` back to one keeps
its prompt cache. That costs a little memory per conversation.

**What happens when a conversation compacts?** Nothing changes for less-bloat. Compaction
summarizes the messages, but the tools at the start of each request stay as they were, so their
cache still holds, and Claude Code lists the name-only tools again.

## Install

Paste this into Claude Code, CLI or desktop:

> Install the less-bloat plugin from the jakobbarnwell/less-bloat marketplace. Then, based on how
> I use Claude Code, tell me whether I should use default or custom mode.

Or install it yourself, in Claude Code:

```
/plugin marketplace add jakobbarnwell/less-bloat
/plugin install less-bloat@less-bloat
```

Or from a terminal:

```bash
claude plugin marketplace add jakobbarnwell/less-bloat
claude plugin install less-bloat@less-bloat
```

It takes effect from the next session. Needs Claude Code 2.1.286 or later.

Skills add bloat too: every installed skill's name and description goes into each new session. We
also recommend running `/skill-doctor` to see which skills you use, and disabling the rest.

## Limits

- **A conversation resumed from an earlier process can miss the prompt cache.** It loads with your
  list as it is now, and with whichever MCP servers have connected by its first prompt, so its first
  request can't reuse the cache when either changed.
- **A name-only tool's first use takes a ToolSearch call** to fetch its full description.
- **An MCP server that connects after your first message** stays as Claude Code placed it until your
  next conversation, as its tools arrive too late to change safely.
- **Needs ToolSearch.** Claude Code turns it off with `ENABLE_TOOL_SEARCH=false`, and by default
  behind a custom `ANTHROPIC_BASE_URL` such as a gateway. Then every tool goes in full.
- **Not in cloud sessions, WSL or Cowork,** which don't load your plugins. In a desktop app
  project, threads that run on your machine load it; cloud threads and the project's coordinator
  don't.

## Credit

Inspired by Matt Pocock's [thread](https://x.com/mattpocockuk/status/2074464823232888987) and
[article](https://www.aihero.dev/how-to-kill-the-bloat-in-claude-codes-system-prompt) on killing the
bloat in Claude Code's system prompt.

## Uninstall

```bash
claude plugin uninstall less-bloat@less-bloat
```

## License

MIT
