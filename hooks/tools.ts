import type { List } from '../types'

// Terms:
// - Up-front (also "in full"): the tool's full description is in every system prompt.
// - Name-only (the engine's "deferred"): only its name is listed; Claude fetches the rest with ToolSearch.
// - Placement: up-front or name-only. A tool keeps its first placement for the whole conversation.
// - Asked: Claude Code itself would put the tool up-front (its own default, or an MCP server's alwaysLoad).
// - Late: connected after the conversation's first prompt; the engine adds it in a message.
// - List: custom mode's tools, placed opposite to default mode.

// Always in full: ToolSearch fetches the others, and a `--json-schema` run ends on StructuredOutput.
export const REQUIRED = ['ToolSearch', 'StructuredOutput']

// What default mode keeps in full, and why. A tool counts only where it exists.
const EVERY_TASK = 'used in almost every task'
const THREAD = "a project thread's turn must end with reply, update_status or no_reply_needed"
export const DEFAULT_UP_FRONT: Record<string, string> = {
  Bash: EVERY_TASK,
  Read: EVERY_TASK,
  Edit: EVERY_TASK,
  Write: EVERY_TASK,
  Glob: EVERY_TASK,
  Grep: EVERY_TASK,
  Agent: 'its description says when to use a subagent',
  Skill: 'its description says when to start a skill',
  AskUserQuestion: 'its description says when to ask you',
  mcp__ccd_session__mark_chapter: 'its description says when to mark a chapter',
  mcp__ccd_session__spawn_task: 'its description says when to flag a side issue as a task',
  SendUserFile: 'its description says to send you the files Claude makes',
  mcp__visualize__read_me: "show_widget's description says to call it first",
  mcp__visualize__show_widget: 'its description says when to draw a chart or diagram',
  mcp__hearthbot__reply: THREAD,
  mcp__hearthbot__update_status: THREAD,
  mcp__hearthbot__no_reply_needed: THREAD,
}

export function isNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(n => typeof n === 'string')
}

// As stored: which way each tool goes, so a later default list can't flip a choice.
export type Saved = { nameOnly: string[]; full: string[] }

export function toSaved(list: List): Saved {
  return { nameOnly: list.filter(n => DEFAULT_UP_FRONT[n]), full: list.filter(n => !DEFAULT_UP_FRONT[n]) }
}

// The list from the store, without what default mode now does anyway.
export function fromSaved(value: unknown): List {
  const { nameOnly, full } = (value ?? {}) as Partial<Saved>
  if (!isNames(nameOnly) || !isNames(full)) return []
  return effective([...nameOnly.filter(n => DEFAULT_UP_FRONT[n]), ...full.filter(n => !DEFAULT_UP_FRONT[n])])
}

// Each tool once, and none required.
export function effective(list: List): List {
  return [...new Set(list)].filter(t => !REQUIRED.includes(t))
}

export function same(a: List, b: List): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
}

// A description's first sentence. A wrapped line carries it on when it starts lowercase, the line
// before ends in no stop or colon, and it isn't a `name:`. "e.g.", "i.e." and "vs." end nothing.
const ENDS_LINE = /(?<!\b(?:[eE]\.g|[iI]\.e|vs))[.!?:]\s*$/
const STARTS_LOWERCASE = /^\s*\p{Ll}/u
const IS_NAME_LINE = /^\s*[\w-]+:(?:\s|$)/
// Up to the first stop not in an abbreviation that is followed by the end, or by a word that starts
// with neither a lowercase letter nor a digit.
const FIRST_SENTENCE = /^(.+?(?<!\b(?:[eE]\.g|[iI]\.e|vs))[.!?])(?=\s+[^\p{Ll}\d\s]|$)/u
export function firstSentence(description: string): string {
  const [first = '', ...rest] = description.trim().split(/\r?\n/)
  let text = first
  for (const line of rest) {
    if (ENDS_LINE.test(text) || !STARTS_LOWERCASE.test(line) || IS_NAME_LINE.test(line)) break
    text += ` ${line}`
  }
  text = text.replace(/\s+/g, ' ').trim()
  const sentence = text.match(FIRST_SENTENCE)?.[1] ?? text
  return sentence.length <= 200 ? sentence : `${sentence.slice(0, 201).replace(/\s+\S*$/, '').slice(0, 200)}…`
}

// The tools up-front under this list: required ones, default ones the list doesn't flip, and the
// list's own up-front picks.
export function upFrontTools(list: List): Set<string> {
  return new Set([...REQUIRED, ...Object.keys(DEFAULT_UP_FRONT).filter(n => !list.includes(n)), ...list.filter(n => !DEFAULT_UP_FRONT[n])])
}
