import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { buttons, counts, elsewhere, fullness, items, state, switched, toolCount } from './pane'
import type { Item, Row } from './pane'
import { CHANGE, COMMAND, notice, report, SETUP, warnings } from './setup'
import type { Input } from './setup'
import { DEFAULT, effective, isList, isNames, loadedInFull, REQUIRED, same } from './tools'
import type { List } from './tools'
import type { Layout, Pane, SavedList } from '../types'

// Each conversation's state is kept by its session id, which /clear and a resume change, and a
// reload of the mod keeps: the tools deferred as its first prompt went out, and each tool's
// placement and whether it asked for its full description, values of their own under
// `<session id>:<tool>`.

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
    const [placed] = await Promise.all([
      update($, { plugin: 'less-bloat', key: 'deferred', id }, first => first ?? isDeferred),
      update($, { plugin: 'less-bloat', key: 'asked', id }, first => first ?? asked),
    ])
    // One the user made name-only themselves needs no telling.
    if (asked && placed && !list?.defer.includes(e.tool)) tell($, e.tool)
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

  // /less-bloat opens the settings pane. A run with nowhere to draw it, such as `claude -p`, or
  // without ToolSearch, gets this conversation's list as text.
  on('command.run', { command: COMMAND.name }, async $ => {
    if (!(await $.session.surfaces()).length) return { text: `${await listing($)}\n\n${CHANGE}` }
    return (await open($, await saved($))) ? {} : { text: await listing($) }
  })

  // The settings pane /less-bloat opens: each tool (or MCP server) checked while in full, in the
  // group default mode puts it in, saved as custom mode's list. It draws from what open() took in,
  // so drawing reads nothing else. Two layouts while the person picks one: every row (checklist), or
  // the counts, groups that open, and the changes from default mode (summary).
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { value: shown } = await $.state.get(PANE)
    if (!shown) return <Text dimColor>Run /less-bloat again.</Text>
    const layout = await layoutOf($)
    const isTerminal = e.surface === 'terminal'
    const isDefault = !shown.draft.keep.length && !shown.draft.defer.length
    const isSaved = same(shown.draft, shown.saved ?? DEFAULT)
    const { full, nameOnly } = counts(shown)
    const absent = elsewhere(shown)
    const shownItems = items(shown, layout)
    const first = shownItems.find(item => 'key' in item)
    // A row goes to full unless all of it is, read from the list as it is when pressed.
    const toggle = (tools: string[]) => redraft($, draft => {
      const kept = loadedInFull(draft)
      return switched(draft, tools, !tools.every(n => kept.has(n)))
    })
    const marks = isTerminal ? { all: '[x]', some: '[-]', none: '[ ]' } : { all: '☑', some: '◩', none: '☐' }
    const mark = (row: Row) => marks[fullness(row)]
    const draw = (item: Item) => {
      const autoFocus = item === first || undefined
      switch (item.kind) {
        case 'heading':
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>{item.title} · {toolCount(item.tools)}</Text>
              {item.about ? <Text dimColor>{item.about}</Text> : null}
            </Box>
          )
        case 'group': {
          const { id } = item
          return (
            <Box flexDirection="column" marginTop={1}>
              <Button key={item.key} plain autoFocus={autoFocus} onPress={() => edit($, p => ({ ...p, open: p.open.includes(id) ? p.open.filter(g => g !== id) : [...p.open, id] }))}>
                {`${item.isOpen ? '▾' : '▸'} ${item.title} · ${toolCount(item.tools)}`}
              </Button>
              {item.about ? <Text dimColor>  {item.about}</Text> : null}
            </Box>
          )
        }
        case 'row': {
          const note = [item.row.note, item.row.changed ? 'changed' : ''].filter(Boolean).join(' · ')
          // The note goes under the name where the two don't fit on one line.
          return (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
              <Button key={item.key} plain autoFocus={autoFocus} onPress={() => toggle(item.row.tools)}>
                {`${mark(item.row)} ${item.row.label}`}
              </Button>
              {note ? <Text dimColor>{note}</Text> : null}
            </Box>
          )
        }
        case 'changes':
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Changes from default{item.tools ? <Text dimColor> · {toolCount(item.tools)}</Text> : null}</Text>
              <Box flexDirection="column" paddingLeft={2}>
                {item.tools ? null : <Text dimColor>None{absent ? ' here' : ''}. Open a group to check or uncheck a tool.</Text>}
                {absent ? <Text dimColor>Custom mode also changes {toolCount(absent)} not listed here.</Text> : null}
              </Box>
            </Box>
          )
        case 'change':
          return (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
              <Text>{item.row.label}<Text dimColor> {item.row.wasFull ? 'in full' : 'name-only'} → {state(item.row)}</Text></Text>
              <Button key={item.key} onPress={() => redraft($, draft => switched(draft, item.row.tools, item.row.wasFull))}>Undo</Button>
            </Box>
          )
      }
    }
    return (
      <Box flexDirection="column">
        {/* Clear of the close mark the terminal draws in the pane's top corner. */}
        <Box paddingRight={isTerminal ? 2 : 0}>
          <Text bold>
            {isDefault ? 'Default mode' : 'Custom mode'}
            <Text dimColor>{isSaved ? ' · saved' : ' · not saved'}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="save" variant="primary" hotkey="s" onPress={() => save($)}>Save</Button>
          <Button key="default" hotkey="d" onPress={() => redraft($, () => DEFAULT)}>Back to default</Button>
          <Button key="layout" hotkey="v" onPress={() => switchLayout($)}>
            {layout === 'checklist' ? 'Try summary layout' : 'Try checklist layout'}
          </Button>
        </Box>
        {/* The terminal's keys, as Claude Code's own menus list theirs; a desktop is clicked. */}
        {isTerminal ? <Text dimColor>↑/↓ move · Enter select · s save · d default · v other layout · Esc close</Text> : null}
        <Box flexDirection="column" marginTop={1}>
          {layout === 'checklist' ? (
            <Text>
              {toolCount(full)} in full, {nameOnly} name-only.
              <Text dimColor> Checked tools are in full: their description is in every system prompt. Unchecked tools are name-only: Claude fetches the description when it needs the tool.</Text>
            </Text>
          ) : (
            <Box flexDirection="column">
              <Text><Text bold>{toolCount(full)} in full:</Text> described in every system prompt.</Text>
              <Text><Text bold>{toolCount(nameOnly)} name-only:</Text> Claude fetches the description when it needs the tool.</Text>
            </Box>
          )}
          {absent && layout === 'checklist' ? <Text dimColor>Custom mode also changes {toolCount(absent)} not listed here.</Text> : null}
          <Text dimColor>{shown.status || 'A saved change applies from your next conversation.'}</Text>
        </Box>
        {shownItems.map(draw)}
      </Box>
    )
  })

  // Where the keyboard is in the pane, for the arrows. Kept apart from the pane's state, so a move
  // doesn't redraw it.
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    const { value: shown } = await $.state.get(PANE)
    if (!result.deny && shown) await $.state.set(RING, buttons(shown, await layoutOf($)).indexOf(e.element ?? ''))
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
    const keys = buttons(shown, await layoutOf($))
    // Undo and Back to default can take away the buttons below the keyboard, which the engine then
    // keeps on the last one, without raising ui.focus. From none of them, as from the close mark,
    // an arrow goes to Save.
    const at = Math.min(ring ?? -1, keys.length - 1)
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
      return { result: input.keep || input.defer ? `Not saved: pass mode to save.\n${await listing($)}` : await listing($) }
    }
    const list = input.mode === 'default' ? DEFAULT : { keep: input.keep ?? [], defer: input.defer ?? [] }
    if (!isList(list)) return { result: 'Not saved: keep and defer must be lists of tool names.' }
    const tools = (await $.tool.list()).map(t => t.name)
    // Saved without the entries that change nothing, as the pane saves it; none left is default mode.
    const kept = effective(list)
    const isDefault = !kept.keep.length && !kept.defer.length
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
// nothing. None saved, one that can't be read, or one that changes nothing means default mode.
async function saved($: EngineInterface): Promise<List | undefined> {
  const list = await $.store.get('list').catch(() => undefined)
  const kept = isList(list) ? effective(list) : DEFAULT
  return kept.keep.length || kept.defer.length ? kept : undefined
}

// The settings pane's id, what it draws, where the keyboard is in it, and its layout.
const PANE_ID = 'less-bloat'
const PANE = { plugin: 'less-bloat', key: 'pane' } as const
const RING = { plugin: 'less-bloat', key: 'ring' } as const
const LAYOUT = { plugin: 'less-bloat', key: 'layout' } as const

async function layoutOf($: EngineInterface): Promise<Layout> {
  return (await $.state.get(LAYOUT)).value ?? 'checklist'
}

// The other layout, with the keyboard on this button and it in view, as the one it was on may be gone.
async function switchLayout($: EngineInterface) {
  await $.state.set(LAYOUT, (await layoutOf($)) === 'checklist' ? 'summary' : 'checklist')
  await $.ui.focus({ requestId: PANE_ID, key: 'layout' })
  await $.ui.scroll({ to: { key: 'layout' }, in: PANE_ID })
}

// Opens the pane on this conversation's tools and the saved list. Says whether it is drawn: not
// without ToolSearch, as then every tool is in full whatever the list.
async function open($: EngineInterface, list: List | undefined): Promise<boolean> {
  const all = (await $.tool.list()).map(t => t.name)
  if (!all.includes('ToolSearch')) return false
  // Not the required tools, nor the setup tool: the pane does what it does.
  const tools = all.filter(n => !REQUIRED.includes(n) && n !== 'mcp__less-bloat__setup')
  await $.state.set(PANE, { tools, asked: await askers($, tools), saved: list ?? null, draft: list ?? DEFAULT, status: '', open: [] })
  return (await $.ui.open({ id: PANE_ID, title: 'less-bloat', focus: true, closeOnEscape: true, holdToasts: true })).isPlaced
}

// Saves the pane's list, whose entries all change something; an empty one is default mode, saved
// as no list.
async function save($: EngineInterface) {
  const { value: shown } = await $.state.get(PANE)
  if (!shown) return
  const isDefault = !shown.draft.keep.length && !shown.draft.defer.length
  try {
    if (isDefault) await $.store.delete('list')
    else await $.store.set('list', shown.draft)
  } catch (error) {
    return edit($, p => ({ ...p, status: `Not saved: ${error instanceof Error ? error.message : error}` }))
  }
  // A toggle pressed while saving isn't saved, so it says nothing.
  const status = 'Saved. It applies from your next conversation.'
  await edit($, p => ({ ...p, saved: isDefault ? null : shown.draft, status: same(p.draft, shown.draft) ? status : p.status }))
}

// Changes the pane's list. Rows stay where they are; only the changes list below them changes.
function redraft($: EngineInterface, change: (draft: SavedList) => SavedList) {
  return edit($, p => ({ ...p, draft: change(p.draft), status: '' }))
}

// Changes what the pane shows.
function edit($: EngineInterface, change: (shown: NonNullable<Pane>) => NonNullable<Pane>) {
  return update($, PANE, p => (p ? change(p) : null))
}
