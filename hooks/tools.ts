// Always loaded in full: ToolSearch loads every other tool, and a `--json-schema` run must end on
// StructuredOutput, which exists only there.
export const REQUIRED = ['ToolSearch', 'StructuredOutput']

// What default mode keeps loaded in full, and why. A tool counts only where it exists, so the
// desktop app's tools stay loaded there and cost nothing in the CLI.
export const RECOMMENDED: Record<string, string> = {
  Bash: 'strongly recommended: runs every shell command',
  Read: 'strongly recommended: reads every file',
  Edit: 'strongly recommended: makes every file edit',
  Write: 'strongly recommended: creates files',
  Glob: 'strongly recommended where it exists: finds files',
  Grep: 'strongly recommended where it exists: searches files',
  Agent: 'recommended: the model delegates to subagents unprompted only when it sees this',
  Skill: 'recommended: the model starts skills unprompted only when it sees this',
  AskUserQuestion: 'recommended: the model asks you instead of guessing only when it sees this',
  SendUserFile: 'recommended: sends you the files the model makes',
  mcp__ccd_session__mark_chapter: 'recommended in the desktop app: chapters for long sessions, used unprompted',
  mcp__ccd_session__spawn_task: 'recommended in the desktop app: offers side tasks, used unprompted',
  mcp__visualize__read_me: 'recommended in the desktop app: show_widget needs it first',
  mcp__visualize__show_widget: 'recommended in the desktop app: draws charts and diagrams inline',
  // A project thread's turn must end with one of these, or the engine sends it back.
  mcp__hearthbot__reply: 'strongly recommended in a project thread: reports back to the project',
  mcp__hearthbot__update_status: 'strongly recommended in a project thread: reports work still running',
  mcp__hearthbot__no_reply_needed: 'strongly recommended in a project thread: ends a turn with no report',
}

// Custom mode's list, as /less-bloat saves it. None saved means default mode.
export type List = { keep: string[]; defer: string[] }

export function isNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(n => typeof n === 'string')
}

export function isList(value: unknown): value is List {
  return typeof value === 'object' && value !== null && isNames((value as List).keep) && isNames((value as List).defer)
}

// The tools to load in full. Custom mode starts from default mode's list and applies its changes,
// so tools that appear later, or only in another app, follow the default. A tool on both lists is
// deferred.
export function loadedInFull(list: List | undefined): Set<string> {
  const loaded = new Set([...REQUIRED, ...Object.keys(RECOMMENDED)])
  for (const n of list?.keep ?? []) loaded.add(n)
  for (const n of list?.defer ?? []) if (!REQUIRED.includes(n)) loaded.delete(n)
  return loaded
}
