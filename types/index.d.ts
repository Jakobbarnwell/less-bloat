// less-bloat's values in $.state, which a reload of the mod keeps. deferred, asked, sentence and named are kept per
// conversation, by its session id, which /clear and a resume change.

// The tools deferred as a conversation's first prompt went out; null or unset before it.
export type Named = string[] | null

// Custom mode's list: the tools to keep in full besides the recommended ones, and the recommended
// ones to make name-only.
export type SavedList = { keep: string[]; defer: string[] }

// What the settings pane draws: the conversation's tools, the ones that asked for their full
// description, the saved list (null in default mode), the list as edited, a line after saving, and
// the groups opened in the summary layout.
export type Pane = { tools: string[]; asked: string[]; saved: SavedList | null; draft: SavedList; status: string; open: string[] } | null

// Which of the two layouts the pane draws, while the person picks one.
export type Layout = 'checklist' | 'summary'

declare module 'claude-code' {
  interface PluginState {
    'less-bloat': {
      // Whether a tool waits behind ToolSearch, as first described; one value per
      // `<session id>:<tool>`, so the tools described at once don't contend for one value.
      deferred: StateFamily<boolean>
      // Whether a tool asked for its full description, as first described: Claude Code would give it.
      asked: StateFamily<boolean>
      // The first sentence of a tool that asked for its full description and got its name only, as
      // first described, or empty: it goes beside the name in the engine's list of deferred tools.
      sentence: StateFamily<string>
      // One value per session id.
      named: StateFamily<Named>
      pane: Pane
      // Where the keyboard is in the pane: its button's place in the keyboard's order.
      ring: number
      layout: Layout
    }
  }
}
