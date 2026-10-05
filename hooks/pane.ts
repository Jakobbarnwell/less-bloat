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
  // Whether the draft differs from default mode for any of its tools.
  isChanged: boolean
}

// What the pane draws below its header, in order: a group's heading (a button that opens and closes
// it in the summary layout), a row, and in the summary layout the changes from default mode.
export type Item =
  | { kind: 'heading'; key?: string; title: string; about: string; tools: number; isOpen?: boolean }
  | { kind: 'row'; key: string; row: Row }
  | { kind: 'changes'; count: number }
  | { kind: 'change'; key: string; row: Row }

const GROUPS = [
  { id: 'kept', title: 'In full by less-bloat', about: '' },
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
  const changed = all.filter(r => r.isChanged)
  return [
    ...grouped.flatMap(g => {
      const isOpen = shown.open.includes(g.id)
      return [
        { kind: 'heading' as const, key: `group:${g.id}`, title: g.title, about: g.about, tools: count(g.rows), isOpen },
        ...(isOpen ? g.rows.map(row => ({ kind: 'row' as const, key: row.key, row })) : []),
      ]
    }),
    { kind: 'changes', count: changed.length },
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

// A row's state as a word or two: in full, name-only, or how many of a server's tools are in full.
export function state(row: Row): string {
  return row.inFull === row.tools.length ? 'in full' : row.inFull ? `${row.inFull} of ${row.tools.length} in full` : 'name-only'
}

function model(shown: Shown): Row[] {
  const full = loadedInFull(shown.draft)
  const byDefault = loadedInFull(undefined)
  return rows(shown.tools).map(row => {
    const n = row.tools.length
    const size = row.isServer ? `${n} ${n === 1 ? 'tool' : 'tools'}` : ''
    return {
      key: `row:${row.label}`,
      label: row.label,
      tools: row.tools,
      // "recommended" is the group's title; "strongly recommended" stays.
      note: [size, row.note.replace(/^recommended: /, '')].filter(Boolean).join(', '),
      inFull: row.tools.filter(t => full.has(t)).length,
      wasFull: row.tools.every(t => byDefault.has(t)),
      isChanged: row.tools.some(t => full.has(t) !== byDefault.has(t)),
    }
  })
}

// Which group a row is in: kept in full by default, made name-only by less-bloat (a tool the notice
// told about, which Claude Code would put in full), or name-only as Claude Code puts it.
function group(shown: Shown, row: Row): (typeof GROUPS)[number]['id'] {
  return row.wasFull ? 'kept' : row.tools.some(t => shown.asked.includes(t)) ? 'made' : 'design'
}
