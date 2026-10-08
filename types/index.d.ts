// less-bloat's values in $.state, which a reload of the mod keeps. deferred, asked, sentence and named are kept per
// conversation, by its session id, which /clear and a resume change.

// The tools a conversation's first prompt went out with; null or unset before it.
export type Named = string[] | null

// Custom mode's list: the tools it places otherwise than default mode does.
export type SavedList = string[]

// What the settings pane draws: the conversation's tools, the ones that asked for their full
// description, the others it lists besides default mode's, the saved list (empty in default mode),
// the list as edited, and a line after saving.
export type Pane = { tools: string[]; asked: string[]; choices: string[]; saved: SavedList; draft: SavedList; status: string } | null

declare module 'claude-code' {
  interface PluginState {
    'less-bloat': {
      // Whether a tool waits behind ToolSearch, as first described; one value per
      // `<session id>:<tool>`, so the tools described at once don't contend for one value.
      deferred: StateFamily<boolean>
      // Whether a tool asked for its full description, as first described: Claude Code would give it.
      asked: StateFamily<boolean>
      // The first sentence of a tool that asked for its full description and got its name only, as
      // first described, or empty: it follows the name in Claude Code's list of name-only tools.
      sentence: StateFamily<string>
      // One value per session id.
      named: StateFamily<Named>
      pane: Pane
      // Where the keyboard is in the pane: its button's key, or empty for none of them.
      ring: string
    }
  }
}
