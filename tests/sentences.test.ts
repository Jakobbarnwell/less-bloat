import { expect, test } from 'claude-code/testing'

import { withSentences } from '../hooks/tools'

// What the engine renders for a deferred_tools_delta: tools loaded in full, then those behind ToolSearch.
const LISTING = [
  'The following tools just became available and are ready to use:',
  'mcp__docs__batch',
  '',
  'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded:',
  'Workflow',
  'mcp__docs__read',
  'WebFetch',
].join('\n')

const SENTENCES = { mcp__docs__batch: 'Create a doc.', Workflow: 'Run a workflow script.' }

test('gives a saved sentence only to a tool behind ToolSearch', async () => {
  expect(withSentences(LISTING, SENTENCES)).toBe(LISTING.replace('\nWorkflow\n', '\nWorkflow: Run a workflow script.\n'))
})

test('leaves the tools no longer available by name', async () => {
  const removed = 'The following deferred tools are no longer available (their MCP server disconnected):\nWorkflow'
  expect(withSentences(removed, SENTENCES)).toBe(removed)
})

// The same listing renders the same way every time, whatever has connected: the prompt cache holds.
test('depends on the listing and the sentences alone', async () => {
  expect(withSentences(LISTING, SENTENCES)).toBe(withSentences(LISTING, { ...SENTENCES }))
  expect(withSentences(LISTING, {})).toBe(LISTING)
})
