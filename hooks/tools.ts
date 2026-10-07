// Always loaded in full: ToolSearch loads every other tool, and a `--json-schema` run must end on
// StructuredOutput, which exists only there.
export const REQUIRED = ['ToolSearch', 'StructuredOutput']

// What default mode keeps in full, and why: the reason for each, as the pane and the setup tool show it.
// A tool counts only where it exists, so the desktop app's tools stay in full there and cost nothing
// in the CLI.
const EVERY_TASK = 'used in almost every task'
// A project thread's turn must end with one of these, or the engine sends it back.
const THREAD = "a project thread's turn must end with reply, update_status or no_reply_needed"
export const RECOMMENDED: Record<string, string> = {
  Bash: EVERY_TASK,
  Read: EVERY_TASK,
  Edit: EVERY_TASK,
  Write: EVERY_TASK,
  Glob: EVERY_TASK,
  Grep: EVERY_TASK,
  // Each of these says in its description when Claude should use it, which its name alone doesn't.
  Agent: 'its description says when to use a subagent',
  Skill: 'its description says when to start a skill',
  AskUserQuestion: 'its description says when to ask you',
  mcp__ccd_session__mark_chapter: 'its description says when to mark a chapter',
  mcp__ccd_session__spawn_task: 'its description says when to flag a side issue as a task',
  SendUserFile: 'its description says to send you the files Claude makes',
  mcp__visualize__read_me: 'show_widget calls it first',
  mcp__visualize__show_widget: 'its description says when to draw a chart or diagram',
  mcp__hearthbot__reply: THREAD,
  mcp__hearthbot__update_status: THREAD,
  mcp__hearthbot__no_reply_needed: THREAD,
}

// Custom mode's list, as /less-bloat saves it. None saved means default mode.
// Custom mode's list: the tools default mode keeps in full that the user made name-only. A tool
// default mode makes name-only stays so.
export type List = string[]

export function isNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(n => typeof n === 'string')
}

// The list as it is saved: only the tools default mode keeps in full, each once. One that changes
// nothing is default mode's, the empty list.
export function effective(list: List): List {
  return [...new Set(list)].filter(t => RECOMMENDED[t])
}

// Whether two lists say the same, in any order.
export function same(a: List, b: List): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
}

// A description's first sentence: its first line, joined by the lines after it that carry on its
// sentence, as a wrapped docstring's do: ones that start lowercase, after a line that doesn't end in a
// stop or colon, and aren't a parameter's `name:`. It ends at the first stop followed by anything but
// a lowercase word or a number. Neither counts the stop of e.g., i.e. or vs. Cut at a word within 200
// characters.
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

// The tools to load in full: default mode's, less the ones custom mode makes name-only.
export function loadedInFull(list: List): Set<string> {
  return new Set([...REQUIRED, ...Object.keys(RECOMMENDED)].filter(n => !list.includes(n)))
}
