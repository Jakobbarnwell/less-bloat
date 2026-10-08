# less-bloat

Kill the bloat in Claude Code's system prompt, without turning a single tool off.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jakobbarnwell)

| Tokens to start a session | Without | With less-bloat | Savings (%) |
| --- | --- | --- | --- |
| CLI, out-of-the-box | 31,728 | 14,153 | 55.4% |
| Desktop app, out-of-the-box | 63,712 | 33,983 | 46.7% |

Measured from the API's usage report: the CLI on Claude Code 2.1.289, the desktop app on one setup
with 2.1.286. Yours depend on your version and what you have connected.

Want to see it work? Ask Claude:

> Start a new interactive Claude Code
> session with less-bloat (https://github.com/jakobbarnwell/less-bloat) installed and one without it, send "hi" in each, and compare the first request's
> total input tokens in their transcripts, cached ones included. Turn less-bloat back on after.

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

It takes effect from the next session. Needs Claude Code 2.1.286 or later. To uninstall:

```bash
claude plugin uninstall less-bloat@less-bloat
```

## How it works

1. Claude Code describes some tools up-front: their name, description and schema are part of every
   system prompt, whether you normally use them or not.
2. The other tools, including most MCP servers', are name-only by design: listed by name. When
   Claude wants to use one, it fetches the full description with ToolSearch.
3. less-bloat makes the rest name-only too, built-in or MCP, and they still work the same. Only the
   fundamental tools stay described up-front. A tool that asks Claude Code for its full description
   keeps its first sentence, to give Claude a hint for what it's for.

## Modes

- **Default** keeps these described up-front: Bash, Read, Edit and Write, Glob and Grep where Claude
  Code has them, Agent, Skill, AskUserQuestion and SendUserFile, plus the desktop app's chapter,
  side-task and widget tools when you're in the app, and a project thread's reply tools.
- **Custom** is your own picks. Run `/less-bloat` to open a pane with the tools where the choice
  matters: the ones Claude Code would describe up-front, the ones default mode keeps up-front, and
  your own picks. It groups them by where your choice puts them, described up-front or name-only,
  and each says where less-bloat's default and Claude Code put it. Check a tool you use often, such
  as Artifact, to describe it up-front, uncheck one you don't need, and save, or ask Claude to. Your
  choice holds for every session, CLI and desktop alike.

Wondering what a tool does? Ask Claude.

A change applies from your next conversation: a new session or `/clear`. The tools sit at the start
of every request, so changing them mid-conversation would throw away the prompt cache.

## Why would I use this

- **Fewer tokens every turn.** The system prompt goes out with every request. Cutting it makes each
  turn cheaper, stretches your usage limits and leaves more room before compaction.
- **More of Claude's attention on your work.** Claude works less well as its context fills up.
  Less of that context goes to describing tools you don't need.
- **Nothing is turned off.** Settings can remove tools, but can't make a built-in tool or the
  desktop app's own servers name-only. Here every tool still works: Claude fetches its full
  description with one ToolSearch call the first time it needs it.
- **No setup.** The default works as is.

## Turning tools off

less-bloat makes tools name-only; it doesn't turn any off. To remove one completely:

- **Deny it** in `~/.claude/settings.json`, which the CLI and the desktop app both read. A tool's name
  removes that tool, `mcp__<server>` every tool of a server:
  `"permissions": { "deny": ["WebSearch", "mcp__playwright"] }`.
- **Turn an MCP server off** with `/mcp`, or remove one you added with `claude mcp remove <name>`.
- **In the desktop app,** turn connectors off in Settings → Connectors.

Skills add bloat too: every installed skill's name and description goes into each new session. Run
`/skill-doctor` to see which skills you use, and disable the rest.

## FAQ

**Does it break the prompt cache?** No. Each tool's placement is fixed for the conversation, and a
change applies from the next one. See Limits for the two cases that cost one request its cache.

**Will Claude get worse at using tools?** No. The everyday tools stay described up-front, and the
rest load when needed. Claude reaches for a name-only tool on its own when its name says what it's
for. Keep a tool described up-front when its name doesn't, as Agent's doesn't say when to delegate.
ToolSearch is always described up-front, since Claude fetches all the others with it.

**Is it safe?** A mod can read and write files, run commands and go online as you, so check what you
install. less-bloat is about 600 lines of TypeScript in `hooks/`, and does none of these.
(`scripts/check.py` is a test you run yourself; the plugin never runs it.) It keeps your choices,
and which tools it has told you about, in Claude Code's own plugin store.

**Does this work for normal Claude, or just Claude Code?** Just Claude Code: the CLI and the
desktop app's Code tab. Chats on claude.ai or in the Claude apps don't run Claude Code plugins.

**How do I see which tools are described up-front?** Run `/less-bloat`. Its pane shows what new
conversations get. To see this conversation's, ask Claude. Where the pane can't open, such as in
`claude -p` or without ToolSearch, `/less-bloat` prints the list instead.

**Does a name-only tool still cost tokens?** Only its name, in Claude Code's list of name-only tools,
and the first sentence of one that asked for its full description. The rest of its description and
its schema come in when Claude fetches them.

**Will I know what it changed?** Your first session shows a toast with how many tools less-bloat
made name-only that Claude Code would describe up-front, and a line in the transcript saying where
they're from. After that, you get one only for a new tool, such as a newly added MCP server's, once.
A `claude -p` run has nowhere to show it, so it waits for a session that does. To see them all, ask
Claude.

**What happens when I add an MCP server?** Most servers' tools are name-only in Claude Code anyway,
so nothing changes. One that asks for its full description gets name-only too, with a notice, if it
connects before your first message (see Limits).

**Does `/clear` reset less-bloat?** The new conversation starts fresh. less-bloat keeps each
earlier conversation's placements in memory until Claude Code exits, so `/resume` back to one keeps
its prompt cache. That costs a little memory per conversation.

**What happens when a conversation compacts?** Nothing changes for less-bloat. Compaction
summarizes the messages, but the tools at the start of each request stay as they were, so their
cache still holds. Claude Code lists the name-only tools again, and less-bloat their first sentences.

## Limits

- **A conversation resumed from an earlier process can miss the prompt cache.** It loads with your
  list as it is now, and with whichever MCP servers have connected by its first prompt, so its first
  request can't reuse the cache when either changed.
- **A name-only tool's first use takes a ToolSearch call** to fetch its full description.
- **An MCP server that connects after your first message** stays as Claude Code placed it until your
  next conversation, as its tools arrive too late to change safely. One of its tools you keep
  described up-front goes into the system prompt when it arrives, which costs that request the
  prompt cache.
- **Needs ToolSearch.** Claude Code turns it off with `ENABLE_TOOL_SEARCH=false`, and by default
  behind a custom `ANTHROPIC_BASE_URL` such as a gateway. Then every tool is described up-front.
- **Not in cloud sessions, WSL or Cowork,** which don't load your plugins. In a desktop app
  project, threads that run on your machine load it; cloud threads and the project's coordinator
  don't.

## Credit

Inspired by Matt Pocock's [thread](https://x.com/mattpocockuk/status/2074464823232888987) and
[article](https://www.aihero.dev/how-to-kill-the-bloat-in-claude-codes-system-prompt) on killing the
bloat in Claude Code's system prompt.

## License

MIT
