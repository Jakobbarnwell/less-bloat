import { loadedInFull, RECOMMENDED, REQUIRED } from './tools'
import type { List } from './tools'
import type { Pane } from '../types'

type Shown = NonNullable<Pane>

export type Row = { key: string; label: string; tools: string[]; note: string; inFull: boolean; changed: boolean }

// Besides default mode's, the tools that asked for their full description, and saved picks. Taken
// as the pane opens, so an unchecked row stays to check again.
export function choices(tools: string[], asked: string[], saved: List): string[] {
  return tools.filter(n => !RECOMMENDED[n] && !REQUIRED.includes(n) && (asked.includes(n) || saved.includes(n)))
}

// The rows, grouped by where the draft puts them.
export function rows(shown: Shown): { upFront: Row[]; nameOnly: Row[] } {
  const full = loadedInFull(shown.draft)
  const row = (key: string, tools: string[]): Row => {
    const inFull = tools.every(t => full.has(t))
    const name = tools.length === 1 ? label(tools[0]!) : `${key}: ${toolCount(tools.length)}`
    const byDefault = Boolean(RECOMMENDED[tools[0]!])
    const atFirst = tools.some(t => shown.asked.includes(t))
    const note = `less-bloat default: ${byDefault ? 'up-front' : 'name-only'} · Claude Code default: ${atFirst ? 'up-front' : 'name-only'}`
    return { key: `row:${key}`, label: name, tools, inFull, note, changed: inFull !== byDefault }
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

// The draft, keeping only the tools whose place now differs from default mode's.
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

export function toolCount(n: number): string {
  return `${n} ${n === 1 ? 'tool' : 'tools'}`
}

function label(name: string): string {
  const [, server, tool] = name.match(/^mcp__(.+?)__(.+)$/) ?? []
  return server && tool ? `${server}: ${tool}` : name
}
