import { effective, loadedInFull, RECOMMENDED, REQUIRED, toSaved } from './tools'
import type { List } from './tools'

// Custom mode through Claude: this tool, which register.tsx answers.
const NAME = 'setup'

export const COMMAND = { name: 'less-bloat', description: 'Choose which tools are described up-front' }

// Shown under the list where the pane can't be drawn, as in `claude -p`.
export const CHANGE = 'To change it, run /less-bloat in a Claude Code session, or ask Claude.'

const DESCRIPTION = `Shows and changes which tools are described up-front, with their full description in every system prompt, and which are name-only, their full description fetched with ToolSearch when Claude wants to use one. The less-bloat plugin makes every tool name-only but the ones it keeps described up-front, and an MCP server's that connects after the first message and asks for its full description. Use these two terms with the user. Run it as a short setup with the user:
1. Call it with no input. It lists this conversation's tools: which are described up-front and why, and which are name-only.
2. Unless the user has said what to change, summarize that for them, then ask with AskUserQuestion. Say which tools default mode keeps described up-front and why, and which Claude Code would describe up-front that less-bloat makes name-only. Offer to make name-only any described up-front they don't need, and to keep described up-front any they use often. Required tools are always described up-front.
3. Show the user what changes, old → new, then call it with mode "custom", nameOnly (tools to make name-only that default mode keeps described up-front) and upFront (other tools to keep described up-front), as exact tool names, or with mode "default" to undo every change. A save replaces the one before.
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

// The list a save makes: entries that change something. A name-only pick may be another app's tool.
// A tool in both lists is in neither.
export function changes(tools: string[], before: List, nameOnly: List, full: List): List {
  const both = (n: string) => nameOnly.includes(n) && full.includes(n)
  const known = (n: string) => tools.includes(n) || before.includes(n)
  return effective([...nameOnly.filter(n => RECOMMENDED[n]), ...full.filter(n => !RECOMMENDED[n] && known(n))].filter(n => !both(n)))
}

// What a save warns about: tools this session lacks, and each name it doesn't save, and why.
export function warnings(tools: string[], before: List, nameOnly: List, full: List): string[] {
  const saved = changes(tools, before, nameOnly, full)
  const given = [...new Set([...nameOnly, ...full])]
  const required = given.filter(n => REQUIRED.includes(n))
  const both = given.filter(n => nameOnly.includes(n) && full.includes(n) && !required.includes(n))
  const left = given.filter(n => !saved.includes(n) && !required.includes(n) && !both.includes(n))
  const unknown = left.filter(n => !RECOMMENDED[n] && !tools.includes(n))
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

// This conversation's tools as placed, with why each is in full. Without ToolSearch, placed is null
// and every tool is in full.
export function report(tools: string[], placed: Record<string, boolean> | null, list: List, surfaces: string[], asked: string[]): string {
  const pending = placed ? tools.filter(n => !(n in placed)) : []
  const full = new Set(tools.filter(n => placed ? placed[n] === false : true))
  const kept = loadedInFull(list)
  const why = (n: string) =>
    REQUIRED.includes(n) ? 'required'
      : !placed ? 'ToolSearch is off'
      : kept.has(n) ? RECOMMENDED[n] ?? 'your pick in custom mode'
      : 'kept as this conversation started, or it arrived later and keeps its own placement'
  const nameOnly = tools.filter(n => !full.has(n) && !pending.includes(n))
  const madeNameOnly = (n: string) => RECOMMENDED[n] && list.includes(n)
  const { nameOnly: made, full: keptFull } = toSaved(list)
  return [
    `Saved mode: ${list.length ? 'custom' : 'default'}. Surfaces: ${surfaces.join(', ') || 'none (a -p run or the SDK)'}.`,
    ...(placed ? [] : ['ToolSearch is off, so every tool is described up-front whatever the mode.']),
    ...(made.length ? [`Custom mode makes these name-only: ${made.join(', ')}.`] : []),
    ...(keptFull.length ? [`Custom mode keeps these described up-front: ${keptFull.join(', ')}.`] : []),
    ...(list.length ? ['A save replaces what custom mode changes.'] : []),
    'Described up-front:',
    ...tools.filter(n => full.has(n)).map(n => `- ${n}: ${why(n)}`),
    ...section('Name-only in custom mode:', nameOnly.filter(madeNameOnly)),
    ...section('Name-only by less-bloat, which Claude Code would describe up-front:', nameOnly.filter(n => asked.includes(n) && !madeNameOnly(n))),
    ...section('Name-only by design:', nameOnly.filter(n => !asked.includes(n) && !madeNameOnly(n))),
    ...section('Placed with the next request:', pending),
  ].join('\n')
}

// A heading and its tools, an MCP server's on one line to keep the list short; nothing for none.
function section(heading: string, tools: string[]): string[] {
  const servers = new Map<string, string[]>()
  const lines: string[] = []
  for (const n of tools) {
    const [, server, tool] = n.match(/^(mcp__.+?__)(.+)$/) ?? []
    if (server && tool && !RECOMMENDED[n]) servers.set(server, [...(servers.get(server) ?? []), tool])
    else lines.push(RECOMMENDED[n] ? `- ${n}: ${RECOMMENDED[n]}` : `- ${n}`)
  }
  return tools.length ? [heading, ...lines, ...[...servers].map(([server, names]) => `- ${server}*: ${names.join(', ')}`)] : []
}

// The notice for tools that asked for their full description and got their name only.
export function notice(tools: string[], first: boolean): { toast: string; line: string } {
  const servers = new Map<string, number>()
  const own: string[] = []
  for (const n of tools) {
    const server = n.match(/^mcp__(.+?)__/)?.[1]
    if (server) servers.set(server, (servers.get(server) ?? 0) + 1)
    else own.push(n)
  }
  // Biggest servers first; connectors named only by an ID are counted together.
  const sorted = [...servers].sort((a, b) => b[1] - a[1])
  const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)
  const named = sorted.filter(([s]) => !isId(s)).map(([s, n]) => `${s} (${n})`)
  const unnamed = sorted.filter(([s]) => isId(s))
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
  const line = [
    `less-bloat made ${count} ${noun} name-only: ${names}.`,
    one ? 'Claude Code would describe it up-front, in every system prompt; Claude now fetches its description only when it uses the tool.'
      : 'Claude Code would describe them up-front, in every system prompt; Claude now fetches each description only when it uses that tool.',
  ].join(' ')
  return { toast, line }
}

function some(names: string[], max = 3): string {
  const shown = names.length > max ? [...names.slice(0, max), `${names.length - max} more`] : names
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown.join('')
}
