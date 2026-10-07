import { loadedInFull, RECOMMENDED, REQUIRED } from './tools'
import type { Pane } from '../types'

type Shown = NonNullable<Pane>

// A row of the settings pane: a tool default mode keeps in full, why, and whether the draft does.
export type Row = { key: string; label: string; tool: string; note: string; inFull: boolean }

// The conversation's tools default mode keeps in full, in RECOMMENDED's order. The others are
// required or name-only in every mode, so the pane doesn't list them.
export function rows(shown: Shown): Row[] {
  const full = loadedInFull(shown.draft)
  return Object.keys(RECOMMENDED).filter(n => shown.tools.includes(n))
    .map(n => ({ key: `row:${n}`, label: label(n), tool: n, note: RECOMMENDED[n]!, inFull: full.has(n) }))
}

// The keys of the pane's buttons in the keyboard's order, as drawn on the terminal.
export function buttons(shown: Shown): string[] {
  return ['save', 'default', ...rows(shown).map(r => r.key)]
}

// How many of the conversation's tools the draft has in full and how many name-only; and how many
// tools are name-only in every mode, so the pane doesn't list them, with how many of those asked
// for their full description, which Claude Code would give them.
export function counts(shown: Shown): { full: number; nameOnly: number; unlisted: number; made: number } {
  const full = loadedInFull(shown.draft)
  const unlisted = shown.tools.filter(t => !RECOMMENDED[t] && !REQUIRED.includes(t))
  const n = shown.tools.filter(t => full.has(t)).length
  return { full: n, nameOnly: shown.tools.length - n, unlisted: unlisted.length, made: unlisted.filter(t => shown.asked.includes(t)).length }
}

// How many tools the draft makes name-only that the pane doesn't list, such as the desktop app's.
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
