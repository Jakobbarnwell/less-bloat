import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { buttons, choices, elsewhere, place, rows, toolCount, unlisted } from './pane'
import type { Row } from './pane'
import { CHANGE, changes, COMMAND, notice, report, SETUP, warnings } from './setup'
import type { Input } from './setup'
import { firstSentence, fromSaved, isNames, loadedInFull, REQUIRED, same, toSaved } from './tools'
import type { List } from './tools'
import type { Pane } from '../types'

// State is kept per conversation, by session id, which /clear and a resume change.

// The engine names the deferred tools described by the first prompt; this note names the rest.
const NOTE = 'Also deferred behind ToolSearch; load with "select:<name>": '

export const register: Register = on => {
  // The describing after /clear or a resume, which the next prompt waits for.
  let redescribed: Promise<unknown> = Promise.resolve()
  // Custom mode's list, read once per conversation, so a save applies from the next one.
  let listed: Promise<List> | undefined
  // After /clear or a resume, each tool's placement, settled once the engine has described it again.
  let placing = new Map<string, { settled: Promise<void>; settle: () => void }>()

  // A tool keeps its first placement all conversation, so the prompt cache holds. One the main loop
  // gets after the first prompt, but a required one, is deferred: the engine then adds it in a
  // message instead of to the tools sent, in full if it would describe it up-front, else by name.
  on('tool.describe', async ($, e, next) => {
    const result = await next(e)
    const list = await (listed ??= saved($))
    const session = await $.session.id()
    const named = await read($, { plugin: 'less-bloat', key: 'named', id: session })
    // The engine's own placement, which an MCP server's alwaysLoad sets.
    const asked = !(result.isDeferred ?? e.isDeferred ?? false)
    const kept = loadedInFull(list)
    const late = Boolean(named && !named.includes(e.tool) && !REQUIRED.includes(e.tool)
      && (await $.tool.list()).some(t => t.name === e.tool))
    const isDeferred = late || !kept.has(e.tool)
    const id = `${session}:${e.tool}`
    const [placed, wasAsked] = await Promise.all([
      update($, { plugin: 'less-bloat', key: 'deferred', id }, first => first ?? isDeferred),
      update($, { plugin: 'less-bloat', key: 'asked', id }, first => first ?? asked),
    ])
    // A late tool gets none: one that asked for its full description is added with it.
    await update($, { plugin: 'less-bloat', key: 'sentence', id }, first => first ?? (wasAsked && placed && !late ? firstSentence(result.description) : ''))
    // One that is late, so added in full, or that the user made name-only or keeps in full, needs no telling.
    if (wasAsked && placed && !late && !list.includes(e.tool) && !kept.has(e.tool)) tell($, e.tool)
    placing.get(e.tool)?.settle()
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
    // Well within the hook's time. An interrupted prompt went out without the note, so isn't the first.
    await Promise.race([redescribed, $.clock.sleep(5_000, { signal: next.signal })]).catch(() => {})
    if (next.signal.aborted) return next(e)
    const named = { plugin: 'less-bloat', key: 'named', id: await $.session.id() } as const
    if (await read($, named)) return next(e)
    const tools = (await $.tool.list()).map(t => t.name)
    const loaded = loadedInFull(await (listed ??= saved($)))
    const deferred = tools.filter(n => !loaded.has(n))
    const { version } = await $.state.set(named, tools)
    const placed = await placements($, tools)
    const unnamed = tools.includes('ToolSearch') ? deferred.filter(n => !(n in placed)) : []
    const result = await next(unnamed.length ? { ...e, context: [...(e.context ?? []), NOTE + unnamed.join(', ')] } : e)
    // A blocked prompt sent nothing, so the next one is still the first, unless another went out since.
    if (result.drop !== undefined) await $.state.set(named, null, { ifVersion: version })
    return result
  })

  // /clear and a resume start a conversation without session.start; the engine forgets its tools just after.
  on('session.end', async ($, e, next) => {
    const restarts = e.reason === 'clear' || e.reason === 'resume'
    if (restarts) listed = undefined
    const result = await next(e)
    if (restarts) {
      placing = new Map((await $.tool.list()).map(t => [t.name, settling()]))
      redescribed = new Promise(done => $.clock.after(0, () => describe($).then(done, done)))
    }
    return result
  })

  // The engine lists the first prompt's name-only tools once this context is computed, from the
  // placements it has recorded, which /clear and a resume forget: so after one, the context waits for
  // each tool's.
  on('prompt.context', async ($, e, next) => {
    if (!placing.size) return next(e)
    const placed = Promise.all([...placing.values()].map(p => p.settled))
    await Promise.race([placed, $.clock.sleep(5_000, { signal: next.signal })]).catch(() => {})
    placing.clear()
    return next(e)
  })

  // A surface that attaches late, as the desktop app's can, shows what waited for one.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (untold.size) announce($)
    return result
  })

  // A name-only tool that asked for its full description gets its first sentence where the engine
  // lists it by name, so Claude knows what it's for. Each agent's list names only its own tools.
  on('prompt.attachment', { type: 'deferred_tools_delta' }, async ($, e, next) => {
    const result = await next(e)
    if (!result.text) return result
    const session = await $.session.id()
    // Lines that aren't a current tool's name: headings, and tools no longer available.
    const tools = new Set((await $.tool.list()).map(t => t.name))
    const lines = await Promise.all(result.text.split('\n').map(async line => {
      const sentence = tools.has(line) && await read($, { plugin: 'less-bloat', key: 'sentence', id: `${session}:${line}` })
      return sentence ? `${line}: ${sentence}` : line
    }))
    return { text: lines.join('\n') }
  })

  // /less-bloat opens the pane, or prints the list where it can't be drawn.
  on('command.run', { command: COMMAND.name }, async $ => {
    if (!(await $.session.surfaces()).length) return { text: `${await listing($)}\n\n${CHANGE}` }
    return (await open($, await saved($))) ? {} : { text: await listing($) }
  })

  // The pane: the tools whose place is a choice, grouped by where the draft puts them.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { value: shown } = await $.state.get(PANE)
    if (!shown) return <Text dimColor>Run /less-bloat again.</Text>
    const isTerminal = e.surface === 'terminal'
    const unlistedCount = unlisted(shown)
    const absent = elsewhere(shown)
    const { upFront, nameOnly } = rows(shown)
    const bullet = (text: string) => (
      <Box flexDirection="row"><Text dimColor>• </Text><Text dimColor>{text}</Text></Box>
    )
    const marks = isTerminal ? { full: '[x]', nameOnly: '[ ]' } : { full: '☑', nameOnly: '☐' }
    const group = (heading: string, hint: string, list: Row[]) => list.length ? (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{heading} ({list.reduce((n, r) => n + r.tools.length, 0)})<Text dimColor> {hint}</Text></Text>
        {list.map(row => (
          // A Button's label takes no color, so the name sits beside the mark.
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
            <Box flexDirection="row" columnGap={1} flexShrink={0}>
              <Button key={row.key} plain autoFocus={row.key === (upFront[0] ?? nameOnly[0])?.key || undefined} onPress={() => redraft($, draft => place(draft, row.tools, !row.inFull))}>
                {row.inFull ? marks.full : marks.nameOnly}
              </Button>
              <Text {...(row.changed ? { color: 'claude' } : {})}>{row.label}</Text>
            </Box>
            <Text dimColor>{row.note}</Text>
          </Box>
        ))}
      </Box>
    ) : null
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
        {isTerminal ? <Text dimColor>↑/↓ move · Enter select · s save · d default · Esc close</Text> : null}
        <Box flexDirection="column" marginTop={1}>
          {bullet('See the less-bloat default and Claude Code default for each tool. If you\'ve changed a tool from the less-bloat default, it\'s orange.')}
          {bullet('Wondering what a tool does? Ask Claude.')}
          {absent ? bullet(`Custom mode also changes ${toolCount(absent)} that this conversation doesn't have.`) : null}
          {bullet(shown.status || 'A saved change applies from your next conversation.')}
        </Box>
        {group('Described up-front', 'In every system prompt. Uncheck one you don\'t need.', upFront)}
        {group('Name-only', 'Claude fetches the description when it needs the tool. Check one you use often.', nameOnly)}
        <Box marginTop={1}>
          <Text dimColor>
            {unlistedCount ? `Not listed: ${toolCount(unlistedCount)} that Claude Code already makes name-only. ` : ''}
            ToolSearch is always described up-front, as Claude fetches the others with it.
          </Text>
        </Box>
      </Box>
    )
  })

  // Where the keyboard is, kept apart from the pane's state so a move doesn't redraw it.
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    const { value: shown } = await $.state.get(PANE)
    if (!result.deny && shown) await $.state.set(RING, e.element ?? '')
    return result
  })

  // ↑/↓ move a button at a time, as in Claude Code's menus; the wheel and page keys still scroll.
  // The event doesn't name its surface, so only a terminal-only session gets this.
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const { value: shown } = await $.state.get(PANE)
    if (!shown || e.origin.kind !== 'person' || e.pointer || Math.abs(e.by) >= e.bodyRows) return next(e)
    if ((await $.session.surfaces()).some(surface => surface !== 'terminal')) return next(e)
    const { value: ring } = await $.state.get(RING)
    const keys = buttons(shown)
    // From none of the buttons, an arrow goes to Save.
    const at = keys.indexOf(ring ?? '')
    const key = keys[Math.min(Math.max(at + e.by, 0), keys.length - 1)]!
    // Past the first or last button, the engine scrolls to what is above or below it.
    if (key === keys[at]) return next(e)
    if ((await $.ui.focus({ requestId: PANE_ID, key })).deny) return next(e)
    await $.ui.scroll({ to: { key }, in: PANE_ID })
    return {}
  })

  on('tool.call', { tool: 'mcp__less-bloat__setup' }, async ($, e) => {
    const input = e as Input
    const given = input.nameOnly || input.upFront
    if (input.mode !== 'default' && input.mode !== 'custom') {
      return { result: input.mode || given ? `Not saved: pass mode "default" or "custom" to save.\n${await listing($)}` : await listing($) }
    }
    if (input.mode === 'custom' && !given) return { result: `Not saved: custom mode needs nameOnly or upFront.\n${await listing($)}` }
    if (input.mode === 'default' && (input.nameOnly?.length || input.upFront?.length)) return { result: `Not saved: default mode takes no nameOnly or upFront.\n${await listing($)}` }
    const nameOnly = input.nameOnly ?? []
    const full = input.upFront ?? []
    if (!isNames(nameOnly) || !isNames(full)) return { result: 'Not saved: nameOnly and upFront must be lists of tool names.' }
    const tools = (await $.tool.list()).map(t => t.name)
    const before = await saved($)
    // Custom mode that changes nothing, as from a typo, saves nothing.
    const kept = changes(tools, before, nameOnly, full)
    if (input.mode === 'custom' && !kept.length) {
      return { result: [`Not saved: this changes nothing from default mode. To go back to default, pass mode "default".`, ...warnings(tools, before, nameOnly, full)].join(' ') }
    }
    const isDefault = !kept.length
    if (isDefault) await $.store.delete('list')
    else await $.store.set('list', toSaved(kept))
    return { result: [`Saved ${isDefault ? 'default' : 'custom'} mode. It applies from the next conversation.`, ...warnings(tools, before, nameOnly, full)].join(' ') }
  })
}

async function listing($: EngineInterface): Promise<string> {
  const tools = (await $.tool.list()).map(t => t.name)
  const placed = tools.includes('ToolSearch') ? await placements($, tools) : null
  const named = await read($, { plugin: 'less-bloat', key: 'named', id: await $.session.id() })
  const late = named && placed ? tools.filter(n => !named.includes(n) && !REQUIRED.includes(n)) : []
  return report(tools, placed, await saved($), [...await $.session.surfaces()], await askers($, tools), late)
}

// Counting the context makes the engine describe the tools connected now. Until the first prompt
// goes out, the first message's context, with its list of name-only tools, is computed again with
// their placements; after, that would spend the prompt cache.
async function describe($: EngineInterface) {
  await $.session.usage({ breakdown: 'summary' })
  if (!(await read($, { plugin: 'less-bloat', key: 'named', id: await $.session.id() }))) $.ui.invalidate('prompt.context')
}

function settling() {
  let settle = () => {}
  const settled = new Promise<void>(done => { settle = done })
  return { settled, settle }
}

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

// Tools that asked for their full description and got their name only, told in batches.
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

// The conversation of the first toast, whose later tools aren't new either.
let opening: string | undefined

// A toast and a transcript line, once per tool ever. With nowhere to draw, as in `claude -p`, they wait.
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

// The tools already shown. A store that can't be read rejects, so nothing is written over.
async function announced($: EngineInterface): Promise<string[] | undefined> {
  const told = await $.store.get('announced')
  return isNames(told) ? told : undefined
}

// Custom mode's list. None saved, or unreadable, is default mode's empty list.
async function saved($: EngineInterface): Promise<List> {
  return fromSaved(await $.store.get('list').catch(() => undefined))
}

const PANE_ID = 'less-bloat'
const PANE = { plugin: 'less-bloat', key: 'pane' } as const
const RING = { plugin: 'less-bloat', key: 'ring' } as const

// Opens the pane, and says whether it's drawn: not without ToolSearch, as then every tool is in full.
async function open($: EngineInterface, list: List): Promise<boolean> {
  const tools = (await $.tool.list()).map(t => t.name)
  if (!tools.includes('ToolSearch')) return false
  const asked = await askers($, tools)
  await $.state.set(PANE, { tools, asked, choices: choices(tools, asked, list), saved: list, draft: list, status: '' })
  // A pane already up keeps where its keyboard is.
  if (!(await $.ui.panes()).some(pane => pane.id === PANE_ID)) await $.state.set(RING, '')
  return (await $.ui.open({ id: PANE_ID, title: 'less-bloat', focus: true, closeOnEscape: true, holdToasts: true })).isPlaced
}

// An empty list is default mode, saved as no list.
async function save($: EngineInterface) {
  const { value: shown } = await $.state.get(PANE)
  if (!shown) return
  const isDefault = !shown.draft.length
  try {
    if (isDefault) await $.store.delete('list')
    else await $.store.set('list', toSaved(shown.draft))
  } catch (error) {
    return edit($, p => ({ ...p, status: `Not saved: ${error instanceof Error ? error.message : error}` }))
  }
  // A toggle pressed while saving isn't saved, so it says nothing.
  const status = 'Saved. It applies from your next conversation.'
  await edit($, p => ({ ...p, saved: shown.draft, status: same(p.draft, shown.draft) ? status : p.status }))
}

function redraft($: EngineInterface, change: (draft: List) => List) {
  return edit($, p => ({ ...p, draft: change(p.draft), status: '' }))
}

function edit($: EngineInterface, change: (shown: NonNullable<Pane>) => NonNullable<Pane>) {
  return update($, PANE, p => (p ? change(p) : null))
}
