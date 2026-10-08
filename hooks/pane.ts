import { loadedInFull, RECOMMENDED, REQUIRED } from './tools'
import type { List } from './tools'
import type { Pane } from '../types'

type Shown = NonNullable<Pane>

// A row of the settings pane: a tool, or an MCP server's tools together, a note on it, and whether
// the draft has it in full.
export type Row = { key: string; label: string; tools: string[]; note: string; inFull: boolean }

// The tools besides default mode's whose place is a choice: the ones Claude Code would put in full,
// which default mode makes name-only, and any other the saved custom mode keeps in full. Taken as
// the pane opens, so a row unchecked and saved stays to check again.
export function choices(tools: string[], asked: string[], saved: List): string[] {
  return tools.filter(n => !RECOMMENDED[n] && !REQUIRED.includes(n) && (asked.includes(n) || saved.includes(n)))
}

// The rows, in two groups: the choices, an MCP server's tools in one row, as a server's can be many;
// and the tools default mode keeps in full, in RECOMMENDED's order. The rest are required, or
// name-only in Claude Code too, so the pane doesn't list them.
export function rows(shown: Shown): { trimmed: Row[]; kept: Row[] } {
  const full = loadedInFull(shown.draft)
  const row = (key: string, name: string, tools: string[], note: string): Row =>
    ({ key: `row:${key}`, label: name, tools, note, inFull: tools.every(t => full.has(t)) })
  const servers = new Map<string, string[]>()
  for (const n of shown.choices) {
    const key = n.match(/^mcp__(.+?)__/)?.[1] ?? n
    servers.set(key, [...(servers.get(key) ?? []), n])
  }
  // One a saved custom mode keeps in full that didn't ask for it says so.
  const trimmed = [...servers].map(([key, tools]) => row(key, tools.length > 1 ? `${key}: ${toolCount(tools.length)}` : label(tools[0]!), tools,
    tools.some(t => shown.asked.includes(t)) ? '' : 'name-only in Claude Code too'))
  const kept = Object.keys(RECOMMENDED).filter(n => shown.tools.includes(n)).map(n => row(n, label(n), [n], RECOMMENDED[n]!))
  return { trimmed, kept }
}

// The draft with these tools put in full, or name-only.
export function place(draft: List, tools: string[], inFull: boolean): List {
  return [...draft.filter(t => !tools.includes(t)), ...tools.filter(t => !RECOMMENDED[t] === inFull)]
}

// The keys of the pane's buttons in the keyboard's order, as drawn on the terminal.
export function buttons(shown: Shown): string[] {
  const { trimmed, kept } = rows(shown)
  return ['save', 'default', ...[...trimmed, ...kept].map(r => r.key)]
}

// How many of the conversation's tools the draft has in full and how many name-only, and how many
// the pane doesn't list but the required ones.
export function counts(shown: Shown): { full: number; nameOnly: number; unlisted: number } {
  const full = loadedInFull(shown.draft)
  const listed = shown.choices.length + rows(shown).kept.length
  const n = shown.tools.filter(t => full.has(t)).length
  return { full: n, nameOnly: shown.tools.length - n, unlisted: shown.tools.filter(t => !REQUIRED.includes(t)).length - listed }
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
