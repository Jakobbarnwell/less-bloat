# `less-bloat`

Kill the bloat in Claude Code's system prompt, without turning a single tool off.

A lightweight Claude mod that strips the bloat from the system prompt **without** turning any tools off. 

one install -> ~50% less tokens in your system prompt

| Tokens to start a session | Without | With `less-bloat` | Savings (%) |
| --- | --- | --- | --- |
| CLI, out-of-the-box | 31,728 | 14,153 | 55.4% |
| Desktop app, out-of-the-box | 63,712 | 33,983 | 46.7% |

Measured from the API's usage report: the CLI on Claude Code 2.1.289, the desktop app on one setup
with 2.1.286. Yours depend on your version and what you have connected.

Want to see it work? Ask Claude:

> Start a new interactive Claude Code
> session with `less-bloat` (https://github.com/jakobbarnwell/less-bloat) installed and one without it and send "hi" in each. Wait for the reply, then compare the first request's
> total input tokens in their transcripts (cached ones included). Turn `less-bloat` back on after, and tell me the results.

## Install

Paste this into Claude Code, CLI or desktop:

> Install the `less-bloat` plugin from the `jakobbarnwell/less-bloat` marketplace. Then, based on how
> I use Claude Code, tell me whether I should use default mode.

Or install it yourself, in Claude Code:

```
/plugin marketplace add jakobbarnwell/less-bloat
/plugin install less-bloat@less-bloat
```

<details>
<summary>Or from a terminal</summary>

```bash
claude plugin marketplace add jakobbarnwell/less-bloat
claude plugin install less-bloat@less-bloat
```

It takes effect from the next session. Needs Claude Code 2.1.286 or later. To uninstall:

```bash
claude plugin uninstall less-bloat@less-bloat
```

</details>

## How it works

Claude works less well as context fills up. 

1. Most tools are name-only: the system prompt mentions only their name. This is by design: when
   Claude wants to use one, **it fetches the full description with ToolSearch.**
2. But Claude Code describes some tools up-front: their name, description and schema are part of
   every session's system prompt, **whether you normally use these tools or not.**
3. **`less-bloat` simply takes most tools that are described up-front and makes them name-only too.** They still work. Claude reaches for their description when needed.

If `less-bloat` moves a tool's full description out of the system prompt, it retains a small hint: **this ensures Claude still knows what the tool does** and when to fetch its description.

## Modes

**Default** keeps these described up-front: Bash, Read, Edit and Write, Glob and Grep where Claude
  Code has them, Agent, Skill, AskUserQuestion and SendUserFile, plus the desktop app's chapter,
  side-task and widget tools when you're in the app, and a project thread's reply tools.
  
**Custom** is your own picks. Run `/less-bloat` to open settings: check a tool to describe it up-front, or uncheck one to make it name-only.

- **In doubt?** Ask Claude to set things up based on your session history.
- **Wondering what a tool does?** Ask Claude.

Your choice holds for every session, CLI and desktop alike.
A change applies from your next conversation: a new session or `/clear`.

## "Why should I use this?"

- **Fewer tokens every turn.** The system prompt goes out with every request. Cutting it makes each
  turn cheaper, stretches your usage limits and leaves more room before compaction.
- **More of Claude's attention on your work.** Claude works less well as its context fills up.
  Less of that context goes to describing tools you don't need.
- **Nothing is turned off.** Settings can remove tools, but can't make a built-in tool or the
  desktop app's own servers name-only. Here every tool still works: Claude fetches its full
  description with one ToolSearch call the first time it needs it.
- **No setup.** The default works as is.

## FAQ

<details>
<summary>Does it break the prompt cache?</summary>

No. Each tool's placement is fixed for the conversation, and a
change applies from the next one. See Limits for the one case that costs a request its cache.

</details>
<details>
<summary>Will Claude get worse at using tools?</summary>

No. The everyday tools stay described up-front, and the
rest load when needed. Claude reaches for a name-only tool on its own when its name says what it's
for. Keep a tool described up-front when its name doesn't, as Agent's doesn't say when to delegate.
ToolSearch is always described up-front, since Claude fetches all the others with it.

</details>
<details>
<summary>Is it safe?</summary>

A plugin can read and write files, run commands and go online as you, so check what you
install. `less-bloat` is about 600 lines of TypeScript in `hooks/`, and does none of these.
(`scripts/check.py` is a test you run yourself; the plugin never runs it.) It keeps your choices,
and which tools it has told you about, in Claude Code's own plugin store.

</details>
<details>
<summary>Does this work for normal Claude, or just Claude Code?</summary>

Just Claude Code: the CLI and the
desktop app's Code tab. Chats on claude.ai or in the Claude apps don't run Claude Code plugins.

</details>
<details>
<summary>How do I see which tools are described up-front?</summary>

Run `/less-bloat`. Its pane shows what new
conversations get. To see this conversation's, ask Claude. Where the pane can't open, such as in
`claude -p` or without ToolSearch, `/less-bloat` prints the list instead.

</details>
<details>
<summary>Does a name-only tool still cost tokens?</summary>

Only its name, in Claude Code's list of name-only tools,
and the first sentence of one that asked for its full description. The rest of its description and
its schema come in when Claude fetches them.

</details>
<details>
<summary>How does <code>less-bloat</code> work with subagents?</summary>

The same way. Each subagent type comes with its own system prompt and set of tools, and `less-bloat` places those tools as it does yours. What you save depends on the type: a `general-purpose` subagent's first request is about half the size, like the main conversation's. `Explore` and `Plan` have no tools to trim, and cost about the same as without it. Each subagent gets hints only for the tools it has. If you run subagents with tools allowed but ToolSearch off, `less-bloat` won't work and all your tools will be fully described in the system prompt up-front.

</details>
<details>
<summary>How do I turn a tool off completely?</summary>

`less-bloat` makes tools name-only; it doesn't turn any off.
To remove one:

- **Deny it** in `~/.claude/settings.json`, which the CLI and the desktop app both read. A tool's name
  removes that tool, `mcp__<server>` every tool of a server:
  `"permissions": { "deny": ["WebSearch", "mcp__playwright"] }`.
- **Turn an MCP server off** with `/mcp`, or remove one you added with `claude mcp remove <name>`.
- **In the desktop app,** turn connectors off in Settings → Connectors.

</details>
<details>
<summary>What about skills?</summary>

Skills add bloat too: every installed skill (with model invocation enabled) has its name and "when-to-use" frontmatter in the system prompt too. Run `/skill-doctor` to see which skills you use, and disable the rest.

</details>
<details>
<summary>Will I know what it changed?</summary>

Your first session shows a toast with how many tools `less-bloat`
made name-only that Claude Code would describe up-front, and a line in the transcript saying where
they're from. After that, you get one only for a new tool, such as a newly added MCP server's, once.

</details>
<details>
<summary>What happens when I add new MCP servers or connectors?</summary>

Almost all added tools are name-only in Claude Code anyway,
so nothing changes. If you install one that asks for its full description in the system prompt, `less-bloat` makes it name-only too, with a notice.

</details>
<details>
<summary>Does <code>/clear</code> reset <code>less-bloat</code>?</summary>

The new conversation starts fresh. `less-bloat` keeps each
earlier conversation's placements in memory until Claude Code exits, so `/resume` back to one keeps
its prompt cache.

</details>
<details>
<summary>What happens when a conversation compacts?</summary>

Nothing changes for `less-bloat`. Compaction
summarizes the messages, but the tools at the start of each request stay as they were, so their
cache still holds. Claude Code lists the name-only tools again, and `less-bloat` their first sentences (the hint).

</details>

## Limits

- **`/resume` can invalidate the prompt cache under specific conditions.** If you quit a session, change your `less-bloat` settings, and reopen it within the cache's lifetime, the cache gets invalidated.
- **A name-only tool's first use takes a ToolSearch call** to fetch its full description.
- **An MCP server that connects late (after your first message)** isn't placed by `less-bloat` in
  that conversation. Claude Code adds its tools in a message instead, which keeps the prompt cache:
  in full if they ask for their full description, by name otherwise.
- **Needs ToolSearch.** Claude Code turns it off with `ENABLE_TOOL_SEARCH=false`, and by default
  behind a custom `ANTHROPIC_BASE_URL` such as a gateway. Then every tool is described up-front.
- **Not in cloud sessions, WSL, normal Claude chats, or Cowork,** which don't load your plugins. In a desktop app's
  Projects, threads that run on your machine load it; cloud threads and the project's coordinator
  don't.

## Credit

Inspired by Matt Pocock's [thread](https://x.com/mattpocockuk/status/2074464823232888987) and
[article](https://www.aihero.dev/how-to-kill-the-bloat-in-claude-codes-system-prompt) on killing the
bloat in Claude Code's system prompt.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jakobbarnwell)

## License

MIT
