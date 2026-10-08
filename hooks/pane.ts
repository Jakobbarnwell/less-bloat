import { upFrontTools, isConnectorId, DEFAULT_UP_FRONT, REQUIRED } from './tools'
import type { List, Pane } from '../types'

type Shown = NonNullable<Pane>

export type Row = { key: string; label: string; tools: string[]; note: string; inFull: boolean; changed: boolean }

// The non-default tools the pane lists: those that asked for their full description, and saved
// picks. Fixed when the pane opens, so a toggled row stays.
export function choices(tools: string[], asked: string[], saved: List): string[] {
  return tools.filter(n => !DEFAULT_UP_FRONT[n] && !REQUIRED.includes(n) && (asked.includes(n) || saved.includes(n)))
}

// The rows, grouped by where the draft puts them.
export function rows(shown: Shown): { upFront: Row[]; nameOnly: Row[] } {
  const full = upFrontTools(shown.draft)
  const row = (key: string, tools: string[]): Row => {
    const inFull = tools.every(t => full.has(t))
    const name = tools.length === 1 ? label(tools[0]!) : `${server(key)}: ${toolCount(tools.length)}`
    const byDefault = Boolean(DEFAULT_UP_FRONT[tools[0]!])
    const asked = tools.some(t => shown.asked.includes(t))
    const note = `less-bloat default: ${byDefault ? 'up-front' : 'name-only'} · Claude Code default: ${asked ? 'up-front' : 'name-only'}`
    return { key: `row:${key}`, label: name, tools, inFull, note, changed: inFull !== byDefault }
  }
  const groups = new Map<string, string[]>()
  for (const n of shown.choices) {
    const key = n.match(/^mcp__(.+?)__/)?.[1] ?? n
    groups.set(key, [...(groups.get(key) ?? []), n])
  }
  const defaults = Object.keys(DEFAULT_UP_FRONT).filter(n => shown.tools.includes(n)).map(n => row(n, [n]))
  // If the setup tool saved a server's tools in different places, each tool gets its own row.
  const others = [...groups].flatMap(([key, tools]) => {
    const up = tools.filter(t => full.has(t)).length
    return up && up < tools.length ? tools.map(t => row(t, [t])) : [row(key, tools)]
  })
  return { upFront: [...defaults, ...others].filter(r => r.inFull), nameOnly: [...others, ...defaults].filter(r => !r.inFull) }
}

// The draft, keeping only the tools whose place now differs from default mode's.
export function place(draft: List, tools: string[], inFull: boolean): List {
  const flips = (t: string) => Boolean(DEFAULT_UP_FRONT[t]) !== inFull
  return [...draft.filter(t => !tools.includes(t)), ...tools.filter(flips)]
}

// The keys of the pane's buttons in the keyboard's order, as drawn on the terminal.
export function buttons(shown: Shown): string[] {
  const { upFront, nameOnly } = rows(shown)
  return ['save', 'default', ...[...upFront, ...nameOnly].map(r => r.key)]
}

// How many of the conversation's tools, not counting required ones, the pane doesn't list.
export function unlisted(shown: Shown): number {
  const listed = shown.choices.length + Object.keys(DEFAULT_UP_FRONT).filter(n => shown.tools.includes(n)).length
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
  const [, key, tool] = name.match(/^mcp__(.+?)__(.+)$/) ?? []
  return key && tool ? `${server(key)}: ${tool}` : name
}

// A connector named only by an ID shows as "connector" and the ID's first part.
function server(key: string): string {
  return isConnectorId(key) ? `connector ${key.slice(0, 8)}` : key
}
