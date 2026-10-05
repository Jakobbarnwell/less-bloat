import { loadedInFull, RECOMMENDED } from './tools'
import type { List } from './tools'
import type { Layout, Pane } from '../types'

type Shown = NonNullable<Pane>

// A row of the settings pane: a tool, or an MCP server's tools. Its group is where default mode
// puts it, so checking or unchecking it never moves it.
export type Row = {
  key: string
  label: string
  tools: string[]
  note: string
  // How many of its tools the draft has in full.
  inFull: number
  // Whether default mode has it in full.
  wasFull: boolean
  // How many of its tools the draft has otherwise than default mode.
  changed: number
}

// What the pane draws below its header, in order: a group's heading, plain in the checklist layout
// and in the summary layout a button that opens and closes the group; a row; and in the summary
// layout the changes from default mode, a heading and a row with Undo for each.
export type Item =
  | { kind: 'heading'; title: string; about: string; tools: number }
  | { kind: 'group'; key: string; id: string; title: string; about: string; tools: number; isOpen: boolean }
  | { kind: 'row'; key: string; row: Row }
  | { kind: 'changes'; tools: number }
  | { kind: 'change'; key: string; row: Row }

const GROUPS = [
  { id: 'kept', title: 'In full by default', about: '' },
  { id: 'made', title: 'Name-only by less-bloat', about: 'Claude Code would put these in full' },
  { id: 'design', title: 'Name-only by design', about: '' },
] as const

export function items(shown: Shown, layout: Layout): Item[] {
  const all = model(shown)
  const grouped = GROUPS.map(g => ({ ...g, rows: all.filter(r => group(shown, r) === g.id) })).filter(g => g.rows.length)
  const count = (list: Row[]) => list.reduce((sum, r) => sum + r.tools.length, 0)
  if (layout === 'checklist') {
    return grouped.flatMap(g => [
      { kind: 'heading' as const, title: g.title, about: g.about, tools: count(g.rows) },
      ...g.rows.map(row => ({ kind: 'row' as const, key: row.key, row })),
    ])
  }
  const changed = all.filter(r => r.changed)
  return [
    ...grouped.flatMap(g => {
      const isOpen = shown.open.includes(g.id)
      return [
        { kind: 'group' as const, key: `group:${g.id}`, id: g.id, title: g.title, about: g.about, tools: count(g.rows), isOpen },
        ...(isOpen ? g.rows.map(row => ({ kind: 'row' as const, key: row.key, row })) : []),
      ]
    }),
    { kind: 'changes', tools: changed.reduce((sum, r) => sum + r.changed, 0) },
    ...changed.map(row => ({ kind: 'change' as const, key: `undo:${row.tools[0]}`, row })),
  ]
}

// The keys of the pane's buttons in the keyboard's order, as drawn on the terminal.
export function buttons(shown: Shown, layout: Layout): string[] {
  return ['save', 'default', 'layout', ...items(shown, layout).flatMap(i => ('key' in i ? [i.key] : []))]
}

// How many of the conversation's tools the draft has in full, and name-only.
export function counts(shown: Shown): { full: number; nameOnly: number } {
  const full = loadedInFull(shown.draft)
  const n = shown.tools.filter(t => full.has(t)).length
  return { full: n, nameOnly: shown.tools.length - n }
}

// Whether all of a row's tools are in full, some or none.
export function fullness(row: Pick<Row, 'tools' | 'inFull'>): 'all' | 'some' | 'none' {
  return row.inFull === row.tools.length ? 'all' : row.inFull ? 'some' : 'none'
}

// The tools a list puts otherwise than default mode does. A list that changes none is default mode.
export function changes(list: List): string[] {
  const full = loadedInFull(list)
  const byDefault = loadedInFull(undefined)
  return [...new Set([...list.keep, ...list.defer])].filter(t => full.has(t) !== byDefault.has(t))
}

// How many tools the list changes that the pane doesn't list, such as another app's or MCP server's.
export function elsewhere(shown: Shown): number {
  return changes(shown.draft).filter(t => !shown.tools.includes(t)).length
}

// A row's state as a word or two: in full, name-only, or how many of a server's tools are in full.
export function state(row: Pick<Row, 'tools' | 'inFull'>): string {
  return { all: 'in full', some: `${row.inFull} of ${row.tools.length} in full`, none: 'name-only' }[fullness(row)]
}

// A count of tools, as "1 tool" or "3 tools".
export function toolCount(n: number): string {
  return `${n} ${n === 1 ? 'tool' : 'tools'}`
}

function model(shown: Shown): Row[] {
  const full = loadedInFull(shown.draft)
  const byDefault = loadedInFull(undefined)
  const changed = new Set(changes(shown.draft))
  return entries(shown.tools).map(row => {
    const inFull = row.tools.filter(t => full.has(t)).length
    const counted = { tools: row.tools, inFull }
    const size = !row.isServer ? '' : fullness(counted) === 'some' ? state(counted) : toolCount(row.tools.length)
    return {
      key: `row:${row.tools[0]}`,
      label: row.label,
      tools: row.tools,
      // The group says these are in full by default; "strongly recommended" stays.
      note: [size, row.note.replace(/^recommended: /, '')].filter(Boolean).join(', '),
      inFull,
      wasFull: row.tools.every(t => byDefault.has(t)),
      changed: row.tools.filter(t => changed.has(t)).length,
    }
  })
}

// Which group a row is in: kept in full by default, made name-only by less-bloat (a tool that asked
// for its full description, which Claude Code would give it), or name-only as Claude Code puts it.
function group(shown: Shown, row: Row): (typeof GROUPS)[number]['id'] {
  return row.wasFull ? 'kept' : row.tools.some(t => shown.asked.includes(t)) ? 'made' : 'design'
}

// Custom mode's list as the pane edits it, back at the default.
export const DEFAULT: List = { keep: [], defer: [] }

// The list with these tools in full or name-only. Keep holds only tools default mode leaves
// name-only, and defer only recommended ones, so a list back at the default is empty.
export function switched(list: List, tools: string[], toFull: boolean): List {
  const keep = new Set(list.keep)
  const defer = new Set(list.defer)
  for (const n of tools) {
    if (toFull) {
      defer.delete(n)
      if (!RECOMMENDED[n]) keep.add(n)
    } else {
      keep.delete(n)
      if (RECOMMENDED[n]) defer.add(n)
    }
  }
  return { keep: [...keep], defer: [...defer] }
}

// Whether two lists say the same, in any order.
export function same(a: List, b: List): boolean {
  const key = (l: List) => JSON.stringify([[...l.keep].sort(), [...l.defer].sort()])
  return key(a) === key(b)
}

type Entry = { label: string; note: string; tools: string[]; isServer: boolean }

// The recommended tools one per row, with why; the others, built-in one per row and MCP ones one
// row per server.
function entries(tools: string[]): Entry[] {
  const recommended = Object.keys(RECOMMENDED).filter(n => tools.includes(n))
    .map(n => ({ label: label(n), note: RECOMMENDED[n]!, tools: [n], isServer: false }))
  const servers = new Map<string, string[]>()
  const own: Entry[] = []
  for (const n of tools.filter(n => !RECOMMENDED[n]).sort()) {
    const server = n.match(/^mcp__(.+?)__/)?.[1]
    if (server) servers.set(server, [...(servers.get(server) ?? []), n])
    else own.push({ label: n, note: '', tools: [n], isServer: false })
  }
  const grouped = [...servers].map(([server, names]) => ({
    label: /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(server) ? `connector ${server.slice(0, 8)}` : server,
    note: '',
    tools: names,
    isServer: true,
  }))
  return [...recommended, ...own, ...grouped]
}

// An MCP tool as `server: tool`.
function label(name: string): string {
  const [, server, tool] = name.match(/^mcp__(.+?)__(.+)$/) ?? []
  return server && tool ? `${server}: ${tool}` : name
}
