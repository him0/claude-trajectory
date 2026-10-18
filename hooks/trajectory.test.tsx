import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'trajectory',
  component: 'Pane',
  requestId: 'trajectory',
  props: {
    title: 'Trajectory',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

async function playOneTurn($: Engine) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'lint の残りを調べて', turnId: 't1' })
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'lint の残りを調べて' }] },
  })
  await $.session.append({
    door: 'attachment',
    origin: { kind: 'composer' },
    uuid: 'u2',
    message: {
      type: 'attachment',
      name: 'nested_memory',
      role: 'user',
      isMeta: true,
      content: [{ type: 'text', text: '<system-reminder>workspace instructions</system-reminder>' }],
    },
  })
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid: 'u3',
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [
        { type: 'text', text: '設定ファイルを洗い出します。' },
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls -la' } },
      ],
    },
  })
  await $.session.append({
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Bash' },
    uuid: 'u4',
    message: {
      type: 'user',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'package.json' }],
    },
  })
}

function bottoms(on: On) {
  mock.clock(on, { now: 1_000 })
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
}

test('every kind of row lands on the timeline, on every surface', async ($, on) => {
  bottoms(on)
  await playOneTurn($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const text of ['SYSTEM', 'USER', 'CONTEXT', 'ASSISTANT', 'TOOL', 'Turn 1', 'nested_memory']) {
      expect(await ui.find({ text: new RegExp(text) })).toBeDefined()
    }
    expect(await ui.find({ text: /Bash .*ls -la.*→ package\.json/ })).toBeDefined()
    await ui.unmount()
  }
})

test('search narrows the rows and modes switch', async ($, on) => {
  bottoms(on)
  await playOneTurn($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'search', text: 'package', kind: 'change' })
  expect(await ui.find({ text: /1\/5 rows/ })).toBeDefined()
  await ui.input({ key: 'search', text: 'zzz', kind: 'change' })
  expect(await ui.find({ text: /No rows match/ })).toBeDefined()

  await ui.press({ key: 'mode-duration' })
  expect((await ui.find({ type: 'Text', text: 'Duration' }))?.props.bold).toBe(true)
  await ui.unmount()
})

test('the system prompt row opens to the prompt the model was sent', async ($, on) => {
  bottoms(on)
  on('prompt.compose', async () => ({
    sections: [
      { id: 'intro', text: 'You are Claude Code.', scope: 'shared' },
      { id: 'env', text: 'cwd: /tmp', scope: 'session' },
    ],
  }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /Initial System Prompt · 2 sections/ })).toBeDefined()
  expect(await ui.find({ text: /You are Claude Code/ })).toBeUndefined()
  await ui.press({ key: 'press-system' })
  expect(await ui.find({ type: 'Text', text: /^## intro \(shared\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^You are Claude Code\.$/ })).toBeDefined()
  await ui.unmount()
})

test('a pressed row opens below the list, and j/k walk the rows', async ($, on) => {
  bottoms(on)
  await playOneTurn($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /Select a row/ })).toBeDefined()
  await ui.press({ key: 'press-tu1' })
  expect(await ui.find({ type: 'Text', text: /^\{"command":"ls -la"\}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^→ package\.json$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3 lines · ≈8 tok$/ })).toBeDefined()

  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: /^設定ファイルを洗い出します。$/ })).toBeDefined()
  await ui.unmount()
})

test('y copies the selected row, its result included', async ($, on) => {
  bottoms(on)
  const copied: string[] = []
  on('ui.copy', async ($, e) => {
    copied.push(e.text)

    return { value: { isCopied: true } }
  })
  on('ui.toast', async () => ({ value: undefined }))
  await playOneTurn($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'copy' })).toBeUndefined()
  await ui.press({ key: 'press-tu1' })
  await ui.press({ key: 'copy' })
  expect(copied).toEqual(['Bash {"command":"ls -la"}\n\n→ package.json'])
  await ui.unmount()
})
