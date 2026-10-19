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
    for (const text of ['SYSTEM', 'USER', 'CONTEXT', 'ASSISTANT', 'TOOL', 'T1', 'nested_memory']) {
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

const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

function composesOnce(on: On) {
  on('prompt.compose', async () => ({
    sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }],
  }))
}

test('a prompt composed before session.start still fills the system row', async ($, on) => {
  bottoms(on)
  composesOnce(on)
  await $.prompt.compose(COMPOSE)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /Initial System Prompt · 1 sections/ })).toBeDefined()
  await ui.unmount()
})

test('opening the pane asks for the prompt when no compose came by', async ($, on) => {
  bottoms(on)
  composesOnce(on)
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.command.run({
    command: 'trajectory',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /Initial System Prompt · 1 sections .* claude-opus-5-5/ })).toBeDefined()
  await ui.unmount()
})

test('the system row keeps its prompt after /clear', async ($, on) => {
  bottoms(on)
  composesOnce(on)
  on('session.end', async () => ({ sessionId: 's1' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.compose(COMPOSE)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /Initial System Prompt · 1 sections/ })).toBeDefined()
  await ui.press({ key: 'press-system' })
  expect(await ui.find({ type: 'Text', text: /^You are Claude Code\.$/ })).toBeDefined()
  await ui.unmount()
})

test('a pressed row opens below the list, and j/k walk the rows', async ($, on) => {
  bottoms(on)
  await playOneTurn($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /Select a row/ })).toBeDefined()
  await ui.press({ key: 'press-tu1' })
  expect(await ui.find({ type: 'Text', text: /^ {2}"command": "ls -la"$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^→ package\.json$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5 lines · ≈8 tok$/ })).toBeDefined()

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
  expect(copied).toEqual(['Bash {\n  "command": "ls -la"\n}\n\n→ package.json'])
  await ui.unmount()
})

test("a tool's JSON result is pretty-printed in the detail, and stays one line in the list", async ($, on) => {
  bottoms(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid: 'u1',
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/tmp/a.json' } }],
    },
  })
  await $.session.append({
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Read' },
    uuid: 'u2',
    message: {
      type: 'user',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '{"ok":true,"n":[1,2]}' }],
    },
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /→ \{"ok":true,"n":\[1,2\]\}/ })).toBeDefined()
  await ui.press({ key: 'press-tu1' })
  expect(await ui.find({ type: 'Text', text: /^→ \{$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}"ok": true,$/ })).toBeDefined()
  await ui.unmount()
})

test('each row shows its role, and r filters by it', async ($, on) => {
  bottoms(on)
  await playOneTurn($)
  await $.session.append({
    door: 'notice',
    origin: { kind: 'composer' },
    uuid: 'u5',
    message: { type: 'system', name: 'away_summary', content: [{ type: 'text', text: 'While you were away…' }] },
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^asst/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^— / })).toBeDefined()

  await ui.press({ key: 'press-u5' })
  expect(await ui.find({ type: 'Text', text: /not sent to the model · notice:away_summary/ })).toBeDefined()
  await ui.press({ key: 'press-u2' })
  expect(await ui.find({ type: 'Text', text: /role: user · attachment:nested_memory/ })).toBeDefined()

  for (const [role, count] of [['system', 1], ['user', 2], ['assistant', 2], ['none', 1], ['all', 6]] as const) {
    await ui.press({ key: 'role-filter' })
    expect(await ui.find({ type: 'Text', text: `role: ${role}` })).toBeDefined()
    expect(await ui.find({ text: new RegExp(`^${count === 6 ? '' : `${count}/`}6 rows$`) })).toBeDefined()
  }
  await ui.unmount()
})

test('the wheel scrolls the list over the list and the detail over the detail', async ($, on) => {
  bottoms(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 40; i++) {
    await $.session.append({
      door: 'prompt',
      origin: { kind: 'composer' },
      uuid: `p${i}`,
      message: {
        type: 'user',
        role: 'user',
        content: [{ type: 'text', text: Array.from({ length: 30 }, (_, n) => `prompt ${i} line ${n}`).join('\n') }],
      },
    })
  }

  // bodyRows 40: 15 list rows (41 rows, so 26 earlier), 15 detail rows from row 23.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const wheel = (by: number, row: number) =>
    $.ui.scroll({
      component: 'Pane',
      requestId: 'trajectory',
      offset: 0,
      by,
      bodyRows: 40,
      contentRows: 39,
      origin: { kind: 'person' },
      pointer: { column: 10, row },
    })
  expect(await ui.find({ text: /▲ 26 earlier/ })).toBeDefined()
  await wheel(-1, 10)
  expect(await ui.find({ text: /▲ 23 earlier/ })).toBeDefined()

  await ui.press({ key: 'press-p30' })
  expect(await ui.find({ text: /1-15\/30 lines/ })).toBeDefined()
  await wheel(1, 25)
  expect(await ui.find({ text: /4-18\/30 lines/ })).toBeDefined()
  expect(await ui.find({ text: /▲ 23 earlier/ })).toBeDefined()
  await ui.unmount()
})
