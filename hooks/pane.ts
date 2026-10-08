import { loadedInFull, RECOMMENDED, REQUIRED } from './tools'
import type { List } from './tools'
import type { Pane } from '../types'

type Shown = NonNullable<Pane>

// A row of the settings pane: a tool, or an MCP server's tools together, a note on it, and whether
// the draft has it in full, which the pane calls described up-front.
export type Row = { key: string; label: string; tools: string[]; note: string; inFull: boolean }

// The tools besides default mode's whose place is a choice: the ones Claude Code would put in full,
// which default mode makes name-only, and any other the saved custom mode keeps in full. Taken as
// the pane opens, so a row unchecked and saved stays to check again.
export function choices(tools: string[], asked: string[], saved: List): string[] {
  return tools.filter(n => !RECOMMENDED[n] && !REQUIRED.includes(n) && (asked.includes(n) || saved.includes(n)))
}

// The rows, in two groups by where the draft puts them: described up-front, then name-only. Listed
// are the tools default mode keeps in full, in RECOMMENDED's order, and the choices, an MCP server's
// tools in one row, as a server's can be many, unless the draft places them apart. The rest are required, or name-only in Claude Code
// too, so the pane doesn't list them.
export function rows(shown: Shown): { upFront: Row[]; nameOnly: Row[] } {
  const full = loadedInFull(shown.draft)
  const row = (key: string, tools: string[]): Row => {
    const inFull = tools.every(t => full.has(t))
    const name = tools.length === 1 ? label(tools[0]!) : `${key}: ${toolCount(tools.length)}`
    return { key: `row:${key}`, label: name, tools, inFull, note: note(tools, shown.asked, inFull) }
  }
  const servers = new Map<string, string[]>()
  for (const n of shown.choices) {
    const key = n.match(/^mcp__(.+?)__/)?.[1] ?? n
    servers.set(key, [...(servers.get(key) ?? []), n])
  }
  const kept = Object.keys(RECOMMENDED).filter(n => shown.tools.includes(n)).map(n => row(n, [n]))
  // A server's tools placed apart, as the setup tool can save them, get a row each.
  const others = [...servers].flatMap(([key, tools]) => {
    const up = tools.filter(t => full.has(t)).length
    return up && up < tools.length ? tools.map(t => row(t, [t])) : [row(key, tools)]
  })
  return { upFront: [...kept, ...others].filter(r => r.inFull), nameOnly: [...others, ...kept].filter(r => !r.inFull) }
}

// What a row says after its name: whether its place is the user's pick, where default mode puts it
// and why, and where Claude Code would.
function note(tools: string[], asked: string[], inFull: boolean): string {
  const why = RECOMMENDED[tools[0]!]
  return [
    inFull !== Boolean(why) ? 'your pick' : '',
    `less-bloat default: ${why ? `up-front, ${why}` : 'name-only'}`,
    `Claude Code: ${tools.some(t => asked.includes(t)) ? 'up-front' : 'name-only'}`,
  ].filter(Boolean).join(' · ')
}

// The draft with these tools put in full, or name-only.
export function place(draft: List, tools: string[], inFull: boolean): List {
  return [...draft.filter(t => !tools.includes(t)), ...tools.filter(t => !RECOMMENDED[t] === inFull)]
}

// The keys of the pane's buttons in the keyboard's order, as drawn on the terminal.
export function buttons(shown: Shown): string[] {
  const { upFront, nameOnly } = rows(shown)
  return ['save', 'default', ...[...upFront, ...nameOnly].map(r => r.key)]
}

// How many of the conversation's tools the pane doesn't list but the required ones.
export function unlisted(shown: Shown): number {
  const listed = shown.choices.length + Object.keys(RECOMMENDED).filter(n => shown.tools.includes(n)).length
  return shown.tools.filter(t => !REQUIRED.includes(t)).length - listed
}

// How many tools the draft changes that this conversation doesn't have, such as the desktop app's.
export function elsewhere(shown: Shown): number {
  return shown.draft.filter(t => !shown.tools.includes(t)).length
}

// A count of tools, as "1 tool" or "3 tools".
export function toolCount(n: number): string {
  return `${n} ${n === 1 ? 'tool' : 'tools'}`
}

// An MCP tool as `server: tool`.
function label(name: string): string {
  const [, server, tool] = name.match(/^mcp__(.+?)__(.+)$/) ?? []
  return server && tool ? `${server}: ${tool}` : name
}
