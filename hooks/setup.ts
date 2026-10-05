import { loadedInFull, RECOMMENDED, REQUIRED } from './tools'
import type { List } from './tools'

// Custom mode's setup is a conversation: `/less-bloat` shows the list and the person says what to
// change, or asks in chat, and the model reads and saves the choices through this tool, which
// register.ts answers.
const NAME = 'setup'

export const COMMAND = { name: 'less-bloat', description: 'Show which tools are in full and which are name-only' }

// What /less-bloat shows below the list, and what it leaves the model.
export const CHANGE = 'To change it, tell Claude what you want, for example to keep your browser tools in full, or to go back to default mode. Changes apply from your next conversation.'
export const NOTE_TO_MODEL = `The user ran /less-bloat, which showed them which tools are in full and which are name-only. If they ask to change that, use the mcp__less-bloat__${NAME} tool, fetching it with ToolSearch if it's name-only, and follow its description.`

const DESCRIPTION = `Shows and changes which tools Claude sees with their full description in every request, and which by name only, their full description fetched with ToolSearch when Claude wants to use one. The less-bloat plugin makes every tool name-only but the ones it keeps in full, and an MCP server's that connects after the first message and asks for its full description. Run it as a short setup with the user:
1. Call it with no input. It lists this conversation's tools: which have their full description and why, and which are name-only.
2. Unless the user has said what to change, summarize that for them, then ask with AskUserQuestion. Say which tools are strongly recommended to keep in full and why. Offer full descriptions for the name-only tools the user is likely to want used unprompted, starting with the ones that asked for theirs, grouped by server, and to make the recommended ones they don't need name-only.
3. Show the user what changes, old → new, then call it with mode "custom", keep (the tools to give their full description besides the recommended ones) and defer (the recommended tools to make name-only), as exact tool names, or with mode "default" to go back to the recommended list.
Changes apply from the next conversation: a new session or /clear.`

const INPUT = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['default', 'custom'] },
    keep: { type: 'array', items: { type: 'string' }, description: 'Exact names of tools to keep in full besides the recommended ones' },
    defer: { type: 'array', items: { type: 'string' }, description: 'Exact names of recommended tools to make name-only' },
  },
}

export type Input = { mode?: 'default' | 'custom'; keep?: string[]; defer?: string[] }

// Registered when the session starts.
export const SETUP = { name: NAME, description: DESCRIPTION, inputSchema: INPUT }

// What a saved custom mode warns about: a name that matches no tool here may be a typo, or a tool
// of another app or MCP server.
export function warnings(tools: string[], { keep, defer }: List): string[] {
  const unknown = [...keep, ...defer].filter(n => !tools.includes(n))
  const idle = defer.filter(n => REQUIRED.includes(n) || (!RECOMMENDED[n] && !keep.includes(n)))
  const both = keep.filter(n => defer.includes(n) && !REQUIRED.includes(n))
  return [
    both.length ? `These are on both lists, so they are name-only: ${both.join(', ')}.` : '',
    unknown.length ? `No tool in this session has these names: ${unknown.join(', ')}.` : '',
    idle.length ? `Making these name-only does nothing, as they are required or name-only already: ${idle.join(', ')}.` : '',
  ].filter(Boolean)
}

// This conversation's tools as they are placed, with the reason for each one in full. The list is
// the saved one, which a save in this conversation changes for the next. Without ToolSearch (placed
// is null) the engine puts every tool in full, whatever the mod says. A tool not in placed connected
// since the last request and is placed with the next. Asked are the tools the toast told about.
export function report(tools: string[], placed: Record<string, boolean> | null, list: List | undefined, surfaces: string[], asked: string[]): string {
  const pending = placed ? tools.filter(n => !(n in placed)) : []
  const full = new Set(tools.filter(n => placed ? placed[n] === false : true))
  const kept = loadedInFull(list)
  const why = (n: string) =>
    REQUIRED.includes(n) ? 'required'
      : !placed ? 'ToolSearch is off'
      : kept.has(n) ? (RECOMMENDED[n] ?? 'added in custom mode')
      : 'kept as this conversation started, or it arrived later and keeps its own placement'
  const nameOnly = tools.filter(n => !full.has(n) && !pending.includes(n))
  return [
    `Saved mode: ${list ? 'custom' : 'default'}. Surfaces: ${surfaces.join(', ') || 'none (a -p run or the SDK)'}.`,
    ...(placed ? [] : ['ToolSearch is off, so every tool goes in full whatever the mode.']),
    ...(list ? [`Custom mode's keep list: ${list.keep.join(', ') || 'empty'}. Its defer list: ${list.defer.join(', ') || 'empty'}.`] : []),
    'Full description:',
    ...tools.filter(n => full.has(n)).map(n => `- ${n}: ${why(n)}`),
    ...section('Name-only, though they asked for their full description:', nameOnly.filter(n => asked.includes(n))),
    ...section('Name-only:', nameOnly.filter(n => !asked.includes(n))),
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
// toast short enough for the CLI's small box, and the names as a line in the transcript. The first
// conversation less-bloat shows one in names the tools there already were, so it doesn't call them
// new.
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
  const count = `${tools.length}${first ? '' : ' new'} ${one ? 'tool' : 'tools'}`
  // Most tools are name-only anyway; the toast counts only the ones that asked for more.
  const toast = `${count} that asked to be in full ${one ? 'is' : 'are'} now name-only. See /less-bloat.`
  const line = [
    `less-bloat made ${count} name-only: ${names}.`,
    one ? 'It asked for its full description in every request; Claude now fetches it only when it uses the tool.'
      : 'They asked for their full descriptions in every request; Claude now fetches each only when it uses that tool.',
    '/less-bloat to see or change.',
  ].join(' ')
  return { toast, line }
}

// Up to max names, then how many more.
function some(names: string[], max = 3): string {
  const shown = names.length > max ? [...names.slice(0, max), `${names.length - max} more`] : names
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown.join('')
}
