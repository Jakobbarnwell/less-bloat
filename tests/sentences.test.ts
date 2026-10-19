import { expect, test } from 'claude-code/testing'

import { withSentences } from '../hooks/tools'

// What the engine renders for a deferred_tools_delta: tools loaded in full, then those behind ToolSearch.
const LISTING = [
  'The following tools just became available and are ready to use:',
  'mcp__docs__batch',
  '',
  'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded:',
  'ScheduleWakeup: schedules when this session resumes work.',
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

// A resumed process renders the listing before its servers connect, and with none of the last
// process's memory: the sentences saved earlier give the same text.
test('gives a disconnected tool its saved sentence', async () => {
  const docs = 'The following deferred tools are now available via ToolSearch:\nmcp__docs__read'
  expect(withSentences(docs, { mcp__docs__read: 'Read a doc.' })).toBe(`${docs}: Read a doc.`)
})
