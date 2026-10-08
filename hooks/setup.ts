import { effective, loadedInFull, RECOMMENDED, REQUIRED, toSaved } from './tools'
import type { List } from './tools'

// Custom mode is set in /less-bloat's pane (register.tsx), or by asking Claude, which reads and saves
// the choices through this tool, which register.tsx answers.
const NAME = 'setup'

export const COMMAND = { name: 'less-bloat', description: 'Choose which tools stay in full' }

// What /less-bloat shows below the list in a run with nowhere to draw, such as `claude -p`.
export const CHANGE = 'To change it, run /less-bloat in a Claude Code session, or ask Claude.'

const DESCRIPTION = `Shows and changes which tools Claude sees with their full description in every system prompt, and which by name only, their full description fetched with ToolSearch when Claude wants to use one. The less-bloat plugin makes every tool name-only but the ones it keeps in full, and an MCP server's that connects after the first message and asks for its full description. Run it as a short setup with the user:
1. Call it with no input. It lists this conversation's tools: which have their full description and why, and which are name-only.
2. Unless the user has said what to change, summarize that for them, then ask with AskUserQuestion. Say which tools default mode keeps in full and why, and which Claude Code would put in full that less-bloat makes name-only. Offer to make the ones in full they don't need name-only, and to keep in full the ones they use often. Required tools always stay in full.
3. Show the user what changes, old → new, then call it with mode "custom", nameOnly (tools default mode keeps in full to make name-only) and full (other tools to keep in full), as exact tool names, or with mode "default" to undo every change. A save replaces the one before.
Changes apply from the next conversation: a new session or /clear.`

const INPUT = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['default', 'custom'] },
    nameOnly: { type: 'array', items: { type: 'string' }, description: 'Exact names of tools default mode keeps in full to make name-only' },
    full: { type: 'array', items: { type: 'string' }, description: 'Exact names of other tools to keep in full' },
  },
}

export type Input = { mode?: 'default' | 'custom'; nameOnly?: string[]; full?: string[] }

// Registered when the session starts.
export const SETUP = { name: NAME, description: DESCRIPTION, inputSchema: INPUT }

// The list a save makes: the tools in nameOnly that default mode keeps in full, which may be another
// app's, such as the desktop app's; and the other tools in full, here or already on the list before.
// A tool in both lists is in neither.
export function changes(tools: string[], before: List, nameOnly: List, full: List): List {
  const both = (n: string) => nameOnly.includes(n) && full.includes(n)
  const known = (n: string) => tools.includes(n) || before.includes(n)
  return effective([...nameOnly.filter(n => RECOMMENDED[n]), ...full.filter(n => !RECOMMENDED[n] && known(n))].filter(n => !both(n)))
}

// What a save warns about: a tool it saves that this session doesn't have; and each name it doesn't
// save: a required tool, one in both lists, one default mode already places that way, and a name of
// no tool here, a typo or another app's tool.
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
    required.length ? `Not saved, as these are always in full: ${required.join(', ')}.` : '',
    both.length ? `Not saved, as these are in both lists: ${both.join(', ')}.` : '',
    already.length ? `Not saved, as default mode already places these that way: ${already.join(', ')}.` : '',
    unknown.length ? `Not saved, as no tool here has these names: ${unknown.join(', ')}.` : '',
  ].filter(Boolean)
}

// This conversation's tools as they are placed, with the reason for each one in full. The list is
// the saved one, which a save in this conversation changes for the next. Without ToolSearch (placed
// is null) the engine puts every tool in full, whatever the mod says. A tool not in placed connected
// since the last request and is placed with the next. Asked are the tools that asked for their
// full description.
export function report(tools: string[], placed: Record<string, boolean> | null, list: List, surfaces: string[], asked: string[]): string {
  const pending = placed ? tools.filter(n => !(n in placed)) : []
  const full = new Set(tools.filter(n => placed ? placed[n] === false : true))
  const kept = loadedInFull(list)
  const why = (n: string) =>
    REQUIRED.includes(n) ? 'required'
      : !placed ? 'ToolSearch is off'
      : kept.has(n) ? RECOMMENDED[n] ?? 'kept in full in custom mode'
      : 'kept as this conversation started, or it arrived later and keeps its own placement'
  const nameOnly = tools.filter(n => !full.has(n) && !pending.includes(n))
  const madeNameOnly = (n: string) => RECOMMENDED[n] && list.includes(n)
  const { nameOnly: made, full: keptFull } = toSaved(list)
  return [
    `Saved mode: ${list.length ? 'custom' : 'default'}. Surfaces: ${surfaces.join(', ') || 'none (a -p run or the SDK)'}.`,
    ...(placed ? [] : ['ToolSearch is off, so every tool goes in full whatever the mode.']),
    ...(made.length ? [`Custom mode makes these name-only: ${made.join(', ')}.`] : []),
    ...(keptFull.length ? [`Custom mode keeps these in full: ${keptFull.join(', ')}.`] : []),
    ...(list.length ? ['A save replaces what custom mode changes.'] : []),
    'Full description:',
    ...tools.filter(n => full.has(n)).map(n => `- ${n}: ${why(n)}`),
    ...section('Name-only in custom mode:', nameOnly.filter(madeNameOnly)),
    ...section('Name-only by less-bloat, which Claude Code would put in full:', nameOnly.filter(n => asked.includes(n) && !madeNameOnly(n))),
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

// The notice for tools that asked for their full description and got their name only: a count in a
// toast, and the names as a line in the transcript. The first conversation less-bloat shows one in
// names the tools there already were, so it doesn't call them new.
export function notice(tools: string[], first: boolean): { toast: string; line: string } {
  const servers = new Map<string, number>()
  const own: string[] = []
  for (const n of tools) {
    const server = n.match(/^mcp__(.+?)__/)?.[1]
    if (server) servers.set(server, (servers.get(server) ?? 0) + 1)
    else own.push(n)
  }
  // Biggest servers first. Some connectors' only name is an ID, such as 1a59c906-04da-…, so they
  // are counted together.
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
  // Most tools are name-only by design; the toast counts only the ones Claude Code would put in full.
  // The engine shows it under less-bloat's name.
  const toast = `${count} non-essential ${noun} that asked to bloat your system prompt ${one ? 'is' : 'are'} now name-only.`
  const line = [
    `less-bloat made ${count} ${noun} name-only: ${names}.`,
    one ? 'Claude Code would put its full description in every system prompt; Claude now fetches it only when it uses the tool.'
      : 'Claude Code would put their full descriptions in every system prompt; Claude now fetches each only when it uses that tool.',
  ].join(' ')
  return { toast, line }
}

// Up to max names, then how many more.
function some(names: string[], max = 3): string {
  const shown = names.length > max ? [...names.slice(0, max), `${names.length - max} more`] : names
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown.join('')
}
