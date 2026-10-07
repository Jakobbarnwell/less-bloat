import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { buttons, counts, elsewhere, rows, toolCount } from './pane'
import { CHANGE, COMMAND, notice, report, SETUP, warnings } from './setup'
import type { Input } from './setup'
import { effective, firstSentence, isNames, loadedInFull, same } from './tools'
import type { List } from './tools'
import type { Pane } from '../types'

// Each conversation's state is kept by its session id, which /clear and a resume change, and a
// reload of the mod keeps: the tools deferred as its first prompt went out, and each tool's
// placement, whether it asked for its full description and its first sentence, values of their own
// under `<session id>:<tool>`.

// The engine names the deferred tools as the first prompt goes out, from the tools described by
// then, and describes the rest only as it sends the request. This note names those.
const NOTE = 'Also deferred behind ToolSearch; load with "select:<name>": '
const SENTENCES = 'Some name-only tools of the main conversation, by the first sentence of their description:'

// Tools wait behind ToolSearch, all but the ones loaded in full: the model sees a tool's name and
// loads its schema when it needs it.
export const register: Register = on => {
  // The describing that follows a /clear or a resume, which the next prompt waits for, so the note
  // names every tool the engine doesn't.
  let redescribed: Promise<unknown> = Promise.resolve()
  // Custom mode's list, read once per conversation, so a save applies from the next one. The engine
  // waits on tool.describe, so a store read for each tool would slow it.
  let listed: Promise<List> | undefined

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
    const [placed, wasAsked] = await Promise.all([
      update($, { plugin: 'less-bloat', key: 'deferred', id }, first => first ?? isDeferred),
      update($, { plugin: 'less-bloat', key: 'asked', id }, first => first ?? asked),
    ])
    await update($, { plugin: 'less-bloat', key: 'sentence', id }, first => first ?? (wasAsked && placed ? firstSentence(result.description) : ''))
    // One the user made name-only themselves needs no telling.
    if (wasAsked && placed && !list.includes(e.tool)) tell($, e.tool)
    return { ...result, isDeferred: placed }
  })

  on('session.start', async ($, e, next) => {
    await $.tool.register(SETUP)
    await $.command.register(COMMAND)
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

  // Claude Code lists each deferred tool by name only. One that asked for its full description and
  // got its name only also gets its first sentence, in a block of the first message's context, so
  // Claude knows what it's for. The engine's list itself is left as it is: it reads its own text.
  // Subagents get the same blocks, hence "of the main conversation". Without ToolSearch every tool
  // is in full.
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const session = await $.session.id()
    const tools = (await $.tool.list()).map(t => t.name).sort()
    if (!tools.includes('ToolSearch')) return result
    const sentences = await Promise.all(tools.map(tool => read($, { plugin: 'less-bloat', key: 'sentence', id: `${session}:${tool}` })))
    const lines = tools.flatMap((tool, i) => sentences[i] ? [`${tool}: ${sentences[i]}`] : [])
    if (!lines.length) return result
    return { ...result, blocks: [...result.blocks, { name: 'nameOnlyTools', text: [SENTENCES, ...lines].join('\n') }] }
  })

  // /less-bloat opens the settings pane. A run with nowhere to draw it, such as `claude -p`, or
  // without ToolSearch, gets this conversation's list as text.
  on('command.run', { command: COMMAND.name }, async $ => {
    if (!(await $.session.surfaces()).length) return { text: `${await listing($)}\n\n${CHANGE}` }
    return (await open($, await saved($))) ? {} : { text: await listing($) }
  })

  // The settings pane /less-bloat opens: each tool default mode keeps in full, checked while in
  // full, and unchecked to make it name-only, saved as custom mode's list. It draws from what open()
  // took in, so drawing reads nothing else.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { value: shown } = await $.state.get(PANE)
    if (!shown) return <Text dimColor>Run /less-bloat again.</Text>
    const isTerminal = e.surface === 'terminal'
    const { full, nameOnly, unlisted, made } = counts(shown)
    const absent = elsewhere(shown)
    const shownRows = rows(shown)
    const marks = isTerminal ? { full: '[x]', nameOnly: '[ ]' } : { full: '☑', nameOnly: '☐' }
    const toggle = (tool: string) => redraft($, draft => (draft.includes(tool) ? draft.filter(t => t !== tool) : [...draft, tool]))
    return (
      <Box flexDirection="column">
        {/* Clear of the close mark the terminal draws in the pane's top corner. */}
        <Box paddingRight={isTerminal ? 2 : 0}>
          <Text bold>
            {shown.draft.length ? 'Custom mode' : 'Default mode'}
            <Text dimColor>{same(shown.draft, shown.saved) ? ' · saved' : ' · not saved'}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="save" variant="primary" hotkey="s" onPress={() => save($)}>Save</Button>
          <Button key="default" hotkey="d" onPress={() => redraft($, () => [])}>Back to default</Button>
        </Box>
        {/* The terminal's keys, as Claude Code's own menus list theirs; a desktop is clicked. */}
        {isTerminal ? <Text dimColor>↑/↓ move · Enter select · s save · d default · Esc close</Text> : null}
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {toolCount(full)} in full, {nameOnly} name-only.
            <Text dimColor> A tool in full has its description in every system prompt; Claude fetches a name-only tool's when it needs the tool.</Text>
          </Text>
          <Text dimColor>
            Default mode keeps these in full, for the reason given. Uncheck the ones you don't need to make them name-only.
            {unlisted ? ` The other ${toolCount(unlisted)} are name-only${made ? `, ${made} of which Claude Code would put in full` : ''}.` : ''}
          </Text>
          {absent ? <Text dimColor>Custom mode also makes {toolCount(absent)} name-only that this conversation doesn't have.</Text> : null}
          <Text dimColor>{shown.status || 'A saved change applies from your next conversation.'}</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {shownRows.length ? null : <Text dimColor>None in this conversation.</Text>}
          {shownRows.map((row, i) => (
            // The note goes under the name where the two don't fit on one line.
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
              <Button key={row.key} plain autoFocus={i === 0 || undefined} onPress={() => toggle(row.tool)}>
                {`${row.inFull ? marks.full : marks.nameOnly} ${row.label}`}
              </Button>
              <Text dimColor>{row.note}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  // Where the keyboard is in the pane, for the arrows. Kept apart from the pane's state, so a move
  // doesn't redraw it.
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    const { value: shown } = await $.state.get(PANE)
    if (!result.deny && shown) await $.state.set(RING, buttons(shown).indexOf(e.element ?? ''))
    return result
  })

  // In the terminal, up and down move the keyboard a button at a time, as in Claude Code's own menus,
  // where the engine would scroll the pane a row (or more, summed while this hook ran); the move
  // scrolls it into view. The wheel and the page keys scroll, and a desktop scrolls as it does.
  // The event doesn't say which surface sent it, so a session with none but the terminal's is one.
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const { value: shown } = await $.state.get(PANE)
    if (!shown || e.origin.kind !== 'person' || e.pointer || Math.abs(e.by) >= e.bodyRows) return next(e)
    if ((await $.session.surfaces()).some(surface => surface !== 'terminal')) return next(e)
    const { value: ring } = await $.state.get(RING)
    const keys = buttons(shown)
    // From none of the buttons, as from the close mark, an arrow goes to Save.
    const at = ring ?? -1
    const key = keys[Math.min(Math.max(at + e.by, 0), keys.length - 1)]!
    // Past the first or last button, the engine scrolls to what is above or below it.
    if (key === keys[at]) return next(e)
    if ((await $.ui.focus({ requestId: PANE_ID, key })).deny) return next(e)
    await $.ui.scroll({ to: { key }, in: PANE_ID })
    return {}
  })

  // The setup tool, as SETUP names it. A save applies from the next conversation: a new session or
  // /clear.
  on('tool.call', { tool: 'mcp__less-bloat__setup' }, async ($, e) => {
    const input = e as Input
    if (!input.mode) {
      return { result: input.nameOnly ? `Not saved: pass mode to save.\n${await listing($)}` : await listing($) }
    }
    if (input.mode === 'custom' && !input.nameOnly) return { result: `Not saved: custom mode needs nameOnly.\n${await listing($)}` }
    if (input.mode === 'default' && input.nameOnly?.length) return { result: 'Not saved: default mode takes no nameOnly.' }
    const list = input.mode === 'default' ? [] : input.nameOnly
    if (!isNames(list)) return { result: 'Not saved: nameOnly must be a list of tool names.' }
    const tools = (await $.tool.list()).map(t => t.name)
    // Saved without the entries that change nothing, as the pane saves it; none left is default mode.
    const kept = effective(list)
    const isDefault = !kept.length
    if (isDefault) await $.store.delete('list')
    else await $.store.set('list', kept)
    return { result: [`Saved ${isDefault ? 'default' : 'custom'} mode. It applies from the next conversation.`, ...warnings(tools, list)].join(' ') }
  })
}

// This conversation's tools as they are placed, as the setup tool and /less-bloat show them.
async function listing($: EngineInterface): Promise<string> {
  const tools = (await $.tool.list()).map(t => t.name)
  const placed = tools.includes('ToolSearch') ? await placements($, tools) : null
  return report(tools, placed, await saved($), [...await $.session.surfaces()], await askers($, tools))
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

// The tools that asked this conversation for their full description, which Claude Code would give them.
async function askers($: EngineInterface, tools: string[]): Promise<string[]> {
  const session = await $.session.id()
  const asked = await Promise.all(tools.map(tool => read($, { plugin: 'less-bloat', key: 'asked', id: `${session}:${tool}` })))
  return tools.filter((_, i) => asked[i])
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

// Custom mode's list, in the mod's store, which every session reads, without entries that change
// nothing. None saved or one that can't be read is default mode's, the empty list.
async function saved($: EngineInterface): Promise<List> {
  const list = await $.store.get('list').catch(() => undefined)
  return isNames(list) ? effective(list) : []
}

// The settings pane's id, what it draws, and where the keyboard is in it.
const PANE_ID = 'less-bloat'
const PANE = { plugin: 'less-bloat', key: 'pane' } as const
const RING = { plugin: 'less-bloat', key: 'ring' } as const

// Opens the pane on this conversation's tools and the saved list. Says whether it is drawn: not
// without ToolSearch, as then every tool is in full whatever the list.
async function open($: EngineInterface, list: List): Promise<boolean> {
  const tools = (await $.tool.list()).map(t => t.name)
  if (!tools.includes('ToolSearch')) return false
  await $.state.set(PANE, { tools, asked: await askers($, tools), saved: list, draft: list, status: '' })
  // On none of its buttons until the first row takes the keyboard; a pane with no rows has none.
  await $.state.set(RING, -1)
  return (await $.ui.open({ id: PANE_ID, title: 'less-bloat', focus: true, closeOnEscape: true, holdToasts: true })).isPlaced
}

// Saves the pane's list, whose entries all change something; an empty one is default mode, saved
// as no list.
async function save($: EngineInterface) {
  const { value: shown } = await $.state.get(PANE)
  if (!shown) return
  const isDefault = !shown.draft.length
  try {
    if (isDefault) await $.store.delete('list')
    else await $.store.set('list', shown.draft)
  } catch (error) {
    return edit($, p => ({ ...p, status: `Not saved: ${error instanceof Error ? error.message : error}` }))
  }
  // A toggle pressed while saving isn't saved, so it says nothing.
  const status = 'Saved. It applies from your next conversation.'
  await edit($, p => ({ ...p, saved: shown.draft, status: same(p.draft, shown.draft) ? status : p.status }))
}

// Changes the pane's list.
function redraft($: EngineInterface, change: (draft: List) => List) {
  return edit($, p => ({ ...p, draft: change(p.draft), status: '' }))
}

// Changes what the pane shows.
function edit($: EngineInterface, change: (shown: NonNullable<Pane>) => NonNullable<Pane>) {
  return update($, PANE, p => (p ? change(p) : null))
}
