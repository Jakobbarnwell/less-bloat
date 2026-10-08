import { effective, isConnectorId, upFrontTools, DEFAULT_UP_FRONT, REQUIRED, toSaved } from './tools'
import type { List } from '../types'

// Custom mode through Claude: this tool, which register.tsx answers.
const NAME = 'setup'

export const COMMAND = { name: 'less-bloat', description: 'Choose which tools are described up-front' }

// Shown under the list where the pane can't be drawn, as in `claude -p`.
export const CHANGE = 'To change it, run /less-bloat in a Claude Code session, or ask Claude.'

const DESCRIPTION = `Shows and changes which tools are described up-front, with their full description in every system prompt, and which are name-only, their full description fetched with ToolSearch when Claude wants to use one. The less-bloat plugin makes every tool name-only but the ones it keeps described up-front; a tool that connects after the first message isn't placed by it in that conversation: Claude Code adds it in a message, with its full description if it would describe it up-front, else by name. Use these two terms with the user. Run it as a short setup with the user:
1. Call it with no input. It lists this conversation's tools: which are described up-front and why, which are name-only, and which Claude Code added in full as they connected late.
2. Check the user's settings for tools they turned off, which step 1 can't list: whole tools in permissions.deny (a rule without parentheses, wildcards included, such as WebSearch, mcp__<server> or mcp__*), servers in disabledMcpjsonServers, and disableClaudeAiConnectors or ENABLE_CLAUDEAI_MCP_SERVERS in env, in ~/.claude/settings.json and the project's .claude/settings.json and .claude/settings.local.json; and servers in disabledMcpServers in the project's entry in ~/.claude.json. Connectors turned off in the desktop app aren't in these files.
3. Unless the user has said what to change, summarize steps 1 and 2 for them, then ask with AskUserQuestion. Say which tools default mode keeps described up-front and why, and which Claude Code would describe up-front that less-bloat makes name-only. Offer to make name-only any described up-front they don't need, and to keep described up-front any they use often. Ask whether they turned any tools off only to save context: turned back on, most would be name-only. Required tools are always described up-front.
4. Show the user what changes, old → new. Turn back on only the tools they picked, as a deny can be for safety: edit the settings files, have them run /mcp enable <server> for a server in disabledMcpServers, or tell them where to turn a connector on. A tool turned back on can be kept up-front with /less-bloat once a conversation has it. Then call it with mode "custom", nameOnly (tools to make name-only that default mode keeps described up-front) and upFront (other tools to keep described up-front), as exact tool names, or with mode "default" to undo every change. A save replaces the one before.
Changes apply from the next conversation: a new session or /clear.`

const INPUT = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['default', 'custom'] },
    nameOnly: { type: 'array', items: { type: 'string' }, description: 'Exact names of tools to make name-only that default mode keeps described up-front' },
    upFront: { type: 'array', items: { type: 'string' }, description: 'Exact names of other tools to keep described up-front' },
  },
}

export type Input = { mode?: 'default' | 'custom'; nameOnly?: string[]; upFront?: string[] }

export const SETUP = { name: NAME, description: DESCRIPTION, inputSchema: INPUT }

// The list a save makes: entries that change something. A name-only pick is kept even if this
// session lacks it (it may be the desktop app's). A tool named in both lists is dropped.
export function changes(tools: string[], before: List, nameOnly: List, upFront: List): List {
  const both = (n: string) => nameOnly.includes(n) && upFront.includes(n)
  const known = (n: string) => tools.includes(n) || before.includes(n)
  return effective([...nameOnly.filter(n => DEFAULT_UP_FRONT[n]), ...upFront.filter(n => !DEFAULT_UP_FRONT[n] && known(n))].filter(n => !both(n)))
}

// What a save warns about: tools this session lacks, and each name it doesn't save, and why.
export function warnings(tools: string[], before: List, nameOnly: List, upFront: List): string[] {
  const saved = changes(tools, before, nameOnly, upFront)
  const given = [...new Set([...nameOnly, ...upFront])]
  const required = given.filter(n => REQUIRED.includes(n))
  const both = given.filter(n => nameOnly.includes(n) && upFront.includes(n) && !required.includes(n))
  const left = given.filter(n => !saved.includes(n) && !required.includes(n) && !both.includes(n))
  const unknown = left.filter(n => !DEFAULT_UP_FRONT[n] && !tools.includes(n))
  const already = left.filter(n => !unknown.includes(n))
  const absent = saved.filter(n => !tools.includes(n))
  return [
    absent.length ? `Saved, though this session doesn't have them: ${absent.join(', ')}.` : '',
    required.length ? `Not saved, as these are always described up-front: ${required.join(', ')}.` : '',
    both.length ? `Not saved, as these are in both lists: ${both.join(', ')}.` : '',
    already.length ? `Not saved, as default mode already places these that way: ${already.join(', ')}.` : '',
    unknown.length ? `Not saved, as no tool here has these names: ${unknown.join(', ')}.` : '',
  ].filter(Boolean)
}

// This conversation's tools as placed, with why each is in full. `deferred` holds each described
// tool's placement; without ToolSearch it is null and every tool is in full. Late tools arrived after
// the first prompt.
export function report({ tools, deferred, list, surfaces, asked, late }: {
  tools: string[]; deferred: Record<string, boolean> | null; list: List; surfaces: string[]; asked: string[]; late: string[]
}): string {
  const unplaced = deferred ? tools.filter(n => !(n in deferred)) : []
  const full = new Set(tools.filter(n => deferred ? deferred[n] === false : true))
  const upFront = upFrontTools(list)
  const why = (n: string) =>
    REQUIRED.includes(n) ? 'required'
      : !deferred ? 'ToolSearch is off'
      : upFront.has(n) ? DEFAULT_UP_FRONT[n] ?? 'your pick in custom mode'
      : 'kept as this conversation started'
  // Of the tools that connected late, Claude Code adds those that asked in full, in a message.
  const added = late.filter(n => asked.includes(n) && !full.has(n) && !unplaced.includes(n))
  // Name-only now, but up-front under the saved list: it connected late, or the list was saved since.
  const later = tools.filter(n => !full.has(n) && !unplaced.includes(n) && !added.includes(n) && upFront.has(n))
  const nameOnly = tools.filter(n => !full.has(n) && !unplaced.includes(n) && !added.includes(n) && !upFront.has(n))
  const madeNameOnly = (n: string) => DEFAULT_UP_FRONT[n] && list.includes(n)
  const { nameOnly: made, full: keptFull } = toSaved(list)
  return [
    `Saved mode: ${list.length ? 'custom' : 'default'}. Surfaces: ${surfaces.join(', ') || 'none (a -p run or the SDK)'}.`,
    ...(deferred ? [] : ['ToolSearch is off, so every tool is described up-front whatever the mode.']),
    ...(made.length ? [`Custom mode makes these name-only: ${made.join(', ')}.`] : []),
    ...(keptFull.length ? [`Custom mode keeps these described up-front: ${keptFull.join(', ')}.`] : []),
    ...(list.length ? ['A save replaces what custom mode changes.'] : []),
    'Described up-front:',
    ...tools.filter(n => full.has(n)).map(n => `- ${n}: ${why(n)}`),
    ...section('Connected after the first message, so Claude Code added them in a message with their full description:', added),
    ...section('Name-only in this conversation, described up-front from the next:', later),
    ...section('Name-only in custom mode:', nameOnly.filter(madeNameOnly)),
    ...section('Name-only by less-bloat, which Claude Code would describe up-front:', nameOnly.filter(n => asked.includes(n) && !madeNameOnly(n))),
    ...section('Name-only by design:', nameOnly.filter(n => !asked.includes(n) && !madeNameOnly(n))),
    ...section('Placed with the next request:', unplaced),
  ].join('\n')
}

// A heading and its tools, an MCP server's on one line to keep the list short; nothing for none.
function section(heading: string, tools: string[]): string[] {
  const servers = new Map<string, string[]>()
  const lines: string[] = []
  for (const n of tools) {
    const [, server, tool] = n.match(/^(mcp__.+?__)(.+)$/) ?? []
    if (server && tool && !DEFAULT_UP_FRONT[n]) servers.set(server, [...(servers.get(server) ?? []), tool])
    else lines.push(DEFAULT_UP_FRONT[n] ? `- ${n}: ${DEFAULT_UP_FRONT[n]}` : `- ${n}`)
  }
  return tools.length ? [heading, ...lines, ...[...servers].map(([server, names]) => `- ${server}*: ${names.join(', ')}`)] : []
}

// The notice for tools that asked for their full description and got their name only. The first
// notice ever, given the mode, says only how many.
export function notice(tools: string[], first: boolean, mode?: 'default' | 'custom'): { toast: string; line: string } {
  const servers = new Map<string, number>()
  const own: string[] = []
  for (const n of tools) {
    const server = n.match(/^mcp__(.+?)__/)?.[1]
    if (server) servers.set(server, (servers.get(server) ?? 0) + 1)
    else own.push(n)
  }
  // Biggest servers first; connectors named only by an ID are counted together.
  const sorted = [...servers].sort((a, b) => b[1] - a[1])
  const named = sorted.filter(([s]) => !isConnectorId(s)).map(([s, n]) => `${s} (${n})`)
  const unnamed = sorted.filter(([s]) => isConnectorId(s))
  const unnamedTools = unnamed.reduce((sum, [, n]) => sum + n, 0)
  const names = [
    ...(own.length ? [some(own)] : []),
    ...(named.length ? [`MCP ${named.length === 1 ? 'server' : 'servers'} ${some(named)}`] : []),
    ...(unnamed.length ? [`${unnamed.length === 1 ? 'a connector' : `${unnamed.length} connectors`} (${unnamedTools})`] : []),
  ].join(', plus ')
  const one = tools.length === 1
  const count = `${tools.length}${first ? '' : ' new'}`
  const noun = one ? 'tool' : 'tools'
  const toast = `${count} non-essential ${noun} that asked to bloat your system prompt ${one ? 'is' : 'are'} now name-only.`
  const line = mode ? `less-bloat applied ${mode === 'default' ? 'its default' : 'your custom'} settings and made ${count} ${noun} name-only + hint. Run /less-bloat to see or change them.` : [
    `less-bloat made ${count} ${noun} name-only + hint: ${names}.`,
    one ? 'Claude Code would describe it up-front, in every system prompt; Claude now fetches its description only when it uses the tool.'
      : 'Claude Code would describe them up-front, in every system prompt; Claude now fetches each description only when it uses that tool.',
  ].join(' ')
  return { toast, line }
}

function some(names: string[], max = 3): string {
  const shown = names.length > max ? [...names.slice(0, max), `${names.length - max} more`] : names
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown.join('')
}
