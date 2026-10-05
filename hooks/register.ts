import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { notice, report, SETUP, warnings } from './setup'
import type { Input } from './setup'
import { isList, isNames, loadedInFull } from './tools'
import type { List } from './tools'

// Each conversation's state is kept by its session id, which /clear and a resume change, and a
// reload of the mod keeps: the tools deferred as its first prompt went out, and each tool's
// placement, a value of its own under `<session id>:<tool>`.

// The engine names the deferred tools as the first prompt goes out, from the tools described by
// then, and describes the rest only as it sends the request. This note names those.
const NOTE = 'Also deferred behind ToolSearch; load with "select:<name>": '

// Tools wait behind ToolSearch, all but the ones loaded in full: the model sees a tool's name and
// loads its schema when it needs it.
export const register: Register = on => {
  // The describing that follows a /clear or a resume, which the next prompt waits for, so the note
  // names every tool the engine doesn't.
  let redescribed: Promise<unknown> = Promise.resolve()
  // Custom mode's list, read once per conversation, so a save applies from the next one. The engine
  // waits on tool.describe, so a store read for each tool would slow it.
  let listed: Promise<List | undefined> | undefined

  // A tool keeps its first placement for the whole conversation, whatever is saved later,
  // so the tools sent stay the same and the prompt cache holds. One that appears after the first
  // prompt, such as a slow MCP server's, wasn't named then, so it keeps the engine's placement,
  // which the engine names itself.
  on('tool.describe', async ($, e, next) => {
    const result = await next(e)
    const list = await (listed ??= saved($))
    const session = await $.session.id()
    const named = await read($, { plugin: 'less-bloat', key: 'named', id: session })
    // The engine's own placement, which an MCP server's alwaysLoad sets.
    const asked = !(result.isDeferred ?? e.isDeferred ?? false)
    const isDeferred = loadedInFull(list).has(e.tool) ? false : !named || named.includes(e.tool) || !asked
    const id = `${session}:${e.tool}`
    const placed = await update($, { plugin: 'less-bloat', key: 'deferred', id }, first => first ?? isDeferred)
    // One the user made name-only themselves needs no telling.
    if (asked && placed && !list?.defer.includes(e.tool)) tell($, e.tool)
    return { ...result, isDeferred: placed }
  })

  on('session.start', async ($, e, next) => {
    await $.tool.register(SETUP)
    const result = await next(e)
    await describe($)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // This wait counts against the hook's time, so it ends well within it: a note that names more
    // than it must beats none. Past the hook's time, or interrupted, the prompt went out without
    // the note, so it must not be marked as the first.
    await Promise.race([redescribed, $.clock.sleep(5_000, { signal: next.signal })]).catch(() => {})
    if (next.signal.aborted) return next(e)
    const named = { plugin: 'less-bloat', key: 'named', id: await $.session.id() } as const
    if (await read($, named)) return next(e)
    const tools = (await $.tool.list()).map(t => t.name)
    const loaded = loadedInFull(await (listed ??= saved($)))
    const deferred = tools.filter(n => !loaded.has(n))
    const { version } = await $.state.set(named, deferred)
    // Without ToolSearch the engine loads every tool in full, whatever the mod says.
    const placed = await placements($, tools)
    const unnamed = tools.includes('ToolSearch') ? deferred.filter(n => !(n in placed)) : []
    const result = await next(unnamed.length ? { ...e, context: [...(e.context ?? []), NOTE + unnamed.join(', ')] } : e)
    // A blocked prompt sent nothing, so the next one is still the first, unless another prompt
    // has gone out since.
    if (result.drop !== undefined) await $.state.set(named, null, { ifVersion: version })
    return result
  })

  // /clear and an in-session resume start a conversation without a session.start. The engine forgets
  // its tool descriptions just after this hook, so describing them again waits a moment.
  on('session.end', async ($, e, next) => {
    const restarts = e.reason === 'clear' || e.reason === 'resume'
    if (restarts) listed = undefined
    const result = await next(e)
    if (restarts) {
      redescribed = new Promise(done => $.clock.after(0, () => describe($).then(done, done)))
    }
    return result
  })

  // A surface that attaches late, as the desktop app's can, shows what waited for one.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (untold.size) announce($)
    return result
  })

  // The setup tool, as SETUP names it. A save applies from the next conversation: a new session or
  // /clear.
  on('tool.call', { tool: 'mcp__less-bloat__setup' }, async ($, e) => {
    const input = e as Input
    const tools = (await $.tool.list()).map(t => t.name)
    if (!input.mode) {
      const placed = tools.includes('ToolSearch') ? await placements($, tools) : null
      const told = await announced($).catch(() => undefined)
      const listing = report(tools, placed, await saved($), [...await $.session.surfaces()], told ?? [])
      return { result: input.keep || input.defer ? `Not saved: pass mode to save.\n${listing}` : listing }
    }
    if (input.mode === 'default') {
      await $.store.delete('list')
      return { result: 'Saved default mode. It applies from the next conversation.' }
    }
    const list = { keep: input.keep ?? [], defer: input.defer ?? [] }
    if (!isList(list)) return { result: 'Not saved: keep and defer must be lists of tool names.' }
    await $.store.set('list', list)
    return { result: ['Saved custom mode. It applies from the next conversation.', ...warnings(tools, list)].join(' ') }
  })
}

// Counting the context, as /context does, describes part of the tools connected now, so the engine
// names those itself and the note stays short.
async function describe($: EngineInterface) {
  await $.session.usage({ breakdown: 'summary' })
}

// This conversation's placement of each of these tools that has been described.
async function placements($: EngineInterface, tools: string[]): Promise<Record<string, boolean>> {
  const session = await $.session.id()
  const placed = await Promise.all(tools.map(async tool =>
    [tool, await read($, { plugin: 'less-bloat', key: 'deferred', id: `${session}:${tool}` })] as const))
  return Object.fromEntries(placed.filter((entry): entry is readonly [string, boolean] => entry[1] !== undefined))
}

// Tools that asked for their full description and got their name only, told a moment after the
// first of a batch is described.
const untold = new Set<string>()
let pending = false
function tell($: EngineInterface, tool: string) {
  untold.add(tool)
  if (pending) return
  pending = true
  $.clock.after(1_000, () => {
    pending = false
    announce($)
  })
}

// One showing at a time, so two never read the same history and one's write drops the other's.
let announcing: Promise<void> = Promise.resolve()
function announce($: EngineInterface) {
  announcing = announcing.then(() => show($)).catch(() => {})
}

// The conversation whose toast was the first less-bloat showed, as its tools described later
// aren't new either.
let opening: string | undefined

// Shows the tools that asked for their full description and got their name only, once each ever,
// in a toast and a transcript line, which the model never sees. Without ToolSearch every tool goes
// in full, so none did. A run with nothing to draw on, such as `claude -p`, shows nothing, so they
// wait for a surface, as they do when the store can't be read.
async function show($: EngineInterface) {
  if (!(await $.session.surfaces()).length) return
  if (!(await $.tool.list()).some(t => t.name === 'ToolSearch')) return untold.clear()
  const told = await announced($)
  const fresh = [...untold].filter(n => !told?.includes(n))
  untold.clear()
  if (!fresh.length) return
  const session = await $.session.id()
  if (!told) opening = session
  const { toast, line } = notice(fresh, opening === session)
  $.ui.toast(toast, { timeoutMs: 15_000 })
  $.ui.log(line)
  await $.store.set('announced', [...told ?? [], ...fresh])
}

// The tools announce has shown, in the mod's store; none means it has shown nothing yet. A store
// that can't be read rejects, so announce never writes over what it couldn't read.
async function announced($: EngineInterface): Promise<string[] | undefined> {
  const told = await $.store.get('announced')
  return isNames(told) ? told : undefined
}

// Custom mode's list, in the mod's store, which every session reads. None saved, or one that can't
// be read, means default mode.
async function saved($: EngineInterface): Promise<List | undefined> {
  const list = await $.store.get('list').catch(() => undefined)
  return isList(list) ? list : undefined
}
