// Always in full: ToolSearch fetches the others, and a `--json-schema` run ends on StructuredOutput.
export const REQUIRED = ['ToolSearch', 'StructuredOutput']

// What default mode keeps in full, and why. A tool counts only where it exists.
const EVERY_TASK = 'used in almost every task'
const THREAD = "a project thread's turn must end with reply, update_status or no_reply_needed"
export const RECOMMENDED: Record<string, string> = {
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

// Custom mode's list: the tools it places opposite to default mode.
export type List = string[]

export function isNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(n => typeof n === 'string')
}

// As stored: which way each tool goes, so a later default list can't flip a choice.
export type Saved = { nameOnly: string[]; full: string[] }

export function toSaved(list: List): Saved {
  return { nameOnly: list.filter(n => RECOMMENDED[n]), full: list.filter(n => !RECOMMENDED[n]) }
}

// The list from the store, without what default mode now does anyway.
export function fromSaved(value: unknown): List {
  const { nameOnly, full } = (value ?? {}) as Partial<Saved>
  if (!isNames(nameOnly) || !isNames(full)) return []
  return effective([...nameOnly.filter(n => RECOMMENDED[n]), ...full.filter(n => !RECOMMENDED[n])])
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
export function firstSentence(description: string): string {
  const [first = '', ...rest] = description.trim().split(/\r?\n/)
  let text = first
  for (const line of rest) {
    if (/(?<!\b(?:[eE]\.g|[iI]\.e|vs))[.!?:]\s*$/.test(text) || !/^\s*\p{Ll}/u.test(line) || /^\s*[\w-]+:(?:\s|$)/.test(line)) break
    text += ` ${line}`
  }
  text = text.replace(/\s+/g, ' ').trim()
  const sentence = text.match(/^(.+?(?<!\b(?:[eE]\.g|[iI]\.e|vs))[.!?])(?=\s+[^\p{Ll}\d\s]|$)/u)?.[1] ?? text
  return sentence.length <= 200 ? sentence : `${sentence.slice(0, 201).replace(/\s+\S*$/, '').slice(0, 200)}…`
}

export function loadedInFull(list: List): Set<string> {
  return new Set([...REQUIRED, ...Object.keys(RECOMMENDED).filter(n => !list.includes(n)), ...list.filter(n => !RECOMMENDED[n])])
}
