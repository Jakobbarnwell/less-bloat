import { rows } from './setup'
import { loadedInFull } from './tools'
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
  isChanged: boolean
}

// What the pane draws below its header, in order: a group's heading (a button that opens and closes
// it in the summary layout), a row, and in the summary layout the changes from default mode.
export type Item =
  | { kind: 'heading'; key?: string; id: string; title: string; about: string; tools: number; isOpen?: boolean }
  | { kind: 'row'; key: string; row: Row }
  | { kind: 'changes'; tools: number; elsewhere: number }
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
      { kind: 'heading' as const, id: g.id, title: g.title, about: g.about, tools: count(g.rows) },
      ...g.rows.map(row => ({ kind: 'row' as const, key: row.key, row })),
    ])
  }
  const changed = all.filter(r => r.isChanged)
  // A saved list can name tools this conversation hasn't, such as another app's or MCP server's.
  const elsewhere = [...shown.draft.keep, ...shown.draft.defer].filter(t => !shown.tools.includes(t)).length
  return [
    ...grouped.flatMap(g => {
      const isOpen = shown.open.includes(g.id)
      return [
        { kind: 'heading' as const, key: `group:${g.id}`, id: g.id, title: g.title, about: g.about, tools: count(g.rows), isOpen },
        ...(isOpen ? g.rows.map(row => ({ kind: 'row' as const, key: row.key, row })) : []),
      ]
    }),
    { kind: 'changes', tools: changed.reduce((sum, r) => sum + r.changed, 0), elsewhere },
    ...changed.map(row => ({ kind: 'change' as const, key: `undo:${row.label}`, row })),
  ]
}

// The keys of the pane's buttons in the keyboard's order, as drawn on the terminal.
export function buttons(shown: Shown, layout: Layout): string[] {
  return ['save', 'default', 'layout', ...items(shown, layout).flatMap(i => ('key' in i && i.key ? [i.key] : []))]
}

// How many of the conversation's tools the draft has in full, and name-only.
export function counts(shown: Shown): { full: number; nameOnly: number } {
  const full = loadedInFull(shown.draft)
  const n = shown.tools.filter(t => full.has(t)).length
  return { full: n, nameOnly: shown.tools.length - n }
}

// Whether all of a row's tools are in full, some or none.
export function fullness(row: Row): 'all' | 'some' | 'none' {
  return row.inFull === row.tools.length ? 'all' : row.inFull ? 'some' : 'none'
}

// A row's state as a word or two: in full, name-only, or how many of a server's tools are in full.
export function state(row: Row): string {
  return { all: 'in full', some: `${row.inFull} of ${row.tools.length} in full`, none: 'name-only' }[fullness(row)]
}

// A count of tools, as "1 tool" or "3 tools".
export function tools(n: number): string {
  return `${n} ${n === 1 ? 'tool' : 'tools'}`
}

function model(shown: Shown): Row[] {
  const full = loadedInFull(shown.draft)
  const byDefault = loadedInFull(undefined)
  return rows(shown.tools).map(row => {
    const size = row.isServer ? tools(row.tools.length) : ''
    const changed = row.tools.filter(t => full.has(t) !== byDefault.has(t)).length
    return {
      key: `row:${row.label}`,
      label: row.label,
      tools: row.tools,
      // The group says these are in full by default; "strongly recommended" stays.
      note: [size, row.note.replace(/^recommended: /, '')].filter(Boolean).join(', '),
      inFull: row.tools.filter(t => full.has(t)).length,
      wasFull: row.tools.every(t => byDefault.has(t)),
      changed,
      isChanged: changed > 0,
    }
  })
}

// Which group a row is in: kept in full by default, made name-only by less-bloat (a tool the notice
// told about, which Claude Code would put in full), or name-only as Claude Code puts it.
function group(shown: Shown, row: Row): (typeof GROUPS)[number]['id'] {
  return row.wasFull ? 'kept' : row.tools.some(t => shown.asked.includes(t)) ? 'made' : 'design'
}
