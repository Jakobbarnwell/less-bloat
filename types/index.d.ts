// less-bloat's values in $.state, which a reload of the mod keeps. deferred and named are kept per
// conversation, by its session id, which /clear and a resume change.

// The tools deferred as a conversation's first prompt went out; null or unset before it.
export type Named = string[] | null

// Custom mode's list: the tools to keep in full besides the recommended ones, and the recommended
// ones to make name-only.
export type SavedList = { keep: string[]; defer: string[] }

// What the settings pane draws: the conversation's tools, the ones that asked to be in full, the
// saved list (null in default mode), the list as edited, and a line after saving.
export type Pane = { tools: string[]; asked: string[]; saved: SavedList | null; draft: SavedList; status: string } | null

declare module 'claude-code' {
  interface PluginState {
    'less-bloat': {
      // Whether a tool waits behind ToolSearch, as first described; one value per
      // `<session id>:<tool>`, so the tools described at once don't contend for one value.
      deferred: StateFamily<boolean>
      // One value per session id.
      named: StateFamily<Named>
      pane: Pane
    }
  }
}
