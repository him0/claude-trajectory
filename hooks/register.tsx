import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  InstructionFile,
  PromptComposeSection,
  PromptContextBlock,
  Register,
  RenderSurface,
  ThemeKey,
} from 'claude-code'

import type {
  TrajectoryKind,
  TrajectoryMeta,
  TrajectoryMode,
  TrajectoryRole,
  TrajectoryRoleFilter,
  TrajectoryRow,
  TrajectoryStep,
  TrajectorySystemPrompt,
  TrajectoryUserContext,
} from '../types'

const PANE = 'trajectory'
const MAX_ROWS = 1000
const MAX_TEXT = 20_000
// A drawn tree shows its first 100,000 characters: leave room around the prompt.
const MAX_SYSTEM_TEXT = 80_000
// Header, search, minimap with its margins, divider and footer.
const CHROME_ROWS = 10
const GUTTER = 5
const BADGE = 10
const MINIMAP_LABEL = 7
const MARK = '⣿'

const rows = atom({ plugin: 'trajectory', key: 'rows' } as const, [] as TrajectoryRow[])
const steps = atom({ plugin: 'trajectory', key: 'steps' } as const, [] as TrajectoryStep[])
const meta = atom({ plugin: 'trajectory', key: 'meta' } as const, {
  startAt: 0,
  turns: 0,
  turnStartAt: 0,
} as TrajectoryMeta)
const mode = atom({ plugin: 'trajectory', key: 'mode' } as const, 'calls' as TrajectoryMode)
const query = atom({ plugin: 'trajectory', key: 'query' } as const, '')
const roleFilter = atom({ plugin: 'trajectory', key: 'roleFilter' } as const, 'all' as TrajectoryRoleFilter)
const selected = atom({ plugin: 'trajectory', key: 'selected' } as const, '')
const listTop = atom({ plugin: 'trajectory', key: 'listTop' } as const, -1)
const detailTop = atom({ plugin: 'trajectory', key: 'detailTop' } as const, 0)
// Kept apart from the rows: the engine may compose the prompt before
// session.start or not again after /clear, and a reset must not lose it.
const systemPrompt = atom(
  { plugin: 'trajectory', key: 'systemPrompt' } as const,
  null as TrajectorySystemPrompt | null,
)
// The context blocks (CLAUDE.md among them) the first user message carries:
// the engine prepends them at request time, so no session.append brings them.
const userContext = atom(
  { plugin: 'trajectory', key: 'userContext' } as const,
  null as TrajectoryUserContext | null,
)
// The reminders already made rows, by where they stand in the conversation:
// injected at request time, they reach no session.append.
const seenReminders = atom({ plugin: 'trajectory', key: 'seenReminders' } as const, [] as string[])

const COLORS: Record<TrajectoryKind, ThemeKey> = {
  system: 'inactive',
  user: 'suggestion',
  context: 'success',
  assistant: 'merged',
  thinking: 'subtle',
  tool: 'warning',
}

const ROLE_FILTERS: TrajectoryRoleFilter[] = ['all', 'system', 'user', 'assistant', 'none']
const ROLE_WIDTH = 5
const roleLabelOf = (role: TrajectoryRole | undefined) =>
  role === 'system' ? 'sys' : role === 'user' ? 'user' : role === 'assistant' ? 'asst' : role === 'none' ? '—' : '?'

type Block = { type: string; [field: string]: unknown }

const clip = (text: string, max = MAX_TEXT) =>
  text.length > max ? `${text.slice(0, max)}… (${text.length - max} more chars)` : text

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

// East Asian wide characters take two cells in a terminal.
const cellsOf = (char: string) => {
  const c = char.codePointAt(0) ?? 0
  const isWide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    c >= 0x20000

  return isWide ? 2 : 1
}

const fit = (text: string, width: number) => {
  if (width <= 0) return ''
  let used = 0
  let out = ''
  for (const char of text) {
    const cells = cellsOf(char)
    if (used + cells > width - 1) {
      const rest = [...text].slice([...out].length)
      if (rest.reduce((n, c) => n + cellsOf(c), 0) + used <= width) return out + rest.join('')

      return `${out}…`
    }
    out += char
    used += cells
  }

  return out
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map(block => {
      const b = block as Block
      if (b.type === 'text') return String(b.text ?? '')
      if (b.type === 'image') return '[image]'
      if (b.type === 'document') return '[document]'

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

const formatTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

const formatMs = (ms: number) =>
  ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`

const systemRow = (at: number, prompt: TrajectorySystemPrompt | null): TrajectoryRow => ({
  id: 'system',
  kind: 'system',
  role: 'system',
  turn: 0,
  at,
  text: 'Initial System Prompt',
  ...prompt,
})

// Keeps the first prompt composed, and fills the system row if it is still bare.
async function recordSystemPrompt($: EngineInterface, sections: readonly PromptComposeSection[], model: string) {
  let prompt = await read($, systemPrompt)
  if (prompt === null) {
    const chars = sections.reduce((n, s) => n + s.text.length, 0)
    const body = sections.map(s => `## ${s.id} (${s.scope})\n${s.text}`).join('\n\n')
    const first = {
      title: `Initial System Prompt · ${sections.length} sections · ${formatTokens(chars)} chars · ${model}`,
      text: clip(body, MAX_SYSTEM_TEXT),
    }
    prompt = first
    await update($, systemPrompt, () => first)
  }
  const list = await read($, rows)
  if (list.some(row => row.id === 'system' && row.title === undefined)) {
    const shown = prompt
    await update($, rows, all => all.map(row => (row.id === 'system' ? { ...row, ...shown, result: undefined } : row)))
  }
}

const contextRow = (at: number, context: TrajectoryUserContext): TrajectoryRow => ({
  id: 'context',
  kind: 'context',
  role: 'user',
  source: 'context',
  turn: 0,
  at,
  ...context,
})

// Rows from the reset start with the system row, then the context row once known.
const openingRows = (at: number, prompt: TrajectorySystemPrompt | null, context: TrajectoryUserContext | null) =>
  context ? [systemRow(at, prompt), contextRow(at, context)] : [systemRow(at, prompt)]

const filesLine = (files: readonly { path: string; kind: string }[]) =>
  files.map(f => `- ${f.path} (${f.kind})`).join('\n')

// Keeps the latest context the engine computed (it computes it again after /clear
// or a compaction), and puts its row after the system row.
async function recordUserContext($: EngineInterface, context: TrajectoryUserContext) {
  await update($, userContext, () => context)
  const at = await $.clock.now()
  await update($, rows, list => {
    if (list.some(row => row.id === 'context')) {
      return list.map(row => (row.id === 'context' ? { ...row, ...context } : row))
    }
    const after = list.findIndex(row => row.id === 'system') + 1
    if (list.length === 0) return list

    return [...list.slice(0, after), contextRow(at, context), ...list.slice(after)].slice(-MAX_ROWS)
  })
}

function contextOfBlocks(blocks: readonly PromptContextBlock[], files: readonly InstructionFile[] | undefined) {
  const shown = blocks.filter(b => b.text.trim() !== '')
  const names = shown.map(b =>
    b.name === 'claudeMd' && files ? `${b.name} (${files.length} files)` : b.name,
  )
  const body = [
    ...(files && files.length > 0 ? [`# instruction files\n${filesLine(files)}`] : []),
    ...shown.map(b => `# ${b.name}\n${b.text}`),
  ].join('\n\n')

  return {
    title: `User Context · ${names.join(' · ') || 'no blocks'}`,
    text: clip(body, MAX_SYSTEM_TEXT),
  }
}

// Where no prompt.context hook ran: the memory files /context lists, read from
// disk now, which may differ from what the session was sent.
async function contextFromDisk($: EngineInterface): Promise<TrajectoryUserContext | null> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const files = usage.context.breakdown?.memoryFiles ?? []
  if (files.length === 0) return null
  const texts = await Promise.all(
    files.map(async f => {
      const content = await $.fs.read(f.path).catch(() => '(could not read)')

      return `## ${f.path} (${f.type})\n${typeof content === 'string' ? content : '(binary)'}`
    }),
  )
  const listed = files.map(f => ({ path: f.path, kind: f.type }))

  return {
    title: `User Context · claudeMd (${files.length} files, read at open)`,
    text: clip(`# instruction files\n${filesLine(listed)}\n\n# claudeMd\n${texts.join('\n\n')}`, MAX_SYSTEM_TEXT),
  }
}

const REMINDER = '<system-reminder>'
// How the engine opens the block that carries the CLAUDE.md files and rules.
const INSTRUCTIONS = 'Codebase and user instructions are shown below'
const MAX_SEEN = 5000

const hashOf = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0

  return `${(h >>> 0).toString(36)}.${text.length}`
}

// The instruction files as the request carried them, in place of the disk's.
function contextOfInstructions(text: string): TrajectoryUserContext {
  const files = [...text.matchAll(/^Contents of (.+?)(?: \(([^)]*)\))?:$/gm)].map(m => ({
    path: m[1] ?? '',
    kind: m[2] ?? 'project',
  }))

  return {
    title: `User Context · claudeMd (${files.length} files, as sent)`,
    text: clip(`# instruction files\n${filesLine(files)}\n\n# claudeMd\n${text}`, MAX_SYSTEM_TEXT),
  }
}

// A reminder is a text block of its own, or is joined onto the end of the
// last tool result (a nested CLAUDE.md, a path-scoped rule a Read brought).
function remindersOf(block: { type: string; [field: string]: unknown }): string[] {
  if (block.type === 'text') {
    const text = typeof block.text === 'string' ? block.text : ''

    return text.trimStart().startsWith(REMINDER) ? [text] : []
  }
  if (block.type !== 'tool_result') return []

  return [...textOf(block.content).matchAll(/<system-reminder>[\s\S]*?<\/system-reminder>/g)].map(m => m[0])
}

// Makes rows of the reminders the request about to be sent carries: the
// trailing user messages, or with `isWhole` the whole conversation.
async function scanRequest($: EngineInterface, isWhole: boolean) {
  const messages = await $.session.messages({ as: 'api' })
  const lastReply = messages.findLastIndex(m => m.role === 'assistant')
  const found: { key: string; text: string }[] = []
  let replies = messages.slice(0, isWhole ? 0 : lastReply + 1).filter(m => m.role === 'assistant').length
  messages.slice(isWhole ? 0 : lastReply + 1).forEach(m => {
    if (m.role === 'assistant') {
      replies++
      return
    }
    const counts = new Map<string, number>()
    for (const text of m.content.flatMap(remindersOf)) {
      const hash = hashOf(text)
      const n = (counts.get(hash) ?? 0) + 1
      counts.set(hash, n)
      found.push({ key: `${replies}:${hash}:${n}`, text })
    }
  })
  if (found.length === 0) return

  let fresh: typeof found = []
  await update($, seenReminders, seen => {
    const known = new Set(seen)
    fresh = found.filter(f => !known.has(f.key))

    return [...seen, ...fresh.map(f => f.key)].slice(-MAX_SEEN)
  })
  const instructions = fresh.find(f => f.text.includes(INSTRUCTIONS))
  if (instructions) await recordUserContext($, contextOfInstructions(instructions.text))

  const [{ turns }, at] = await Promise.all([read($, meta), $.clock.now()])
  await push(
    $,
    fresh
      .filter(f => f !== instructions)
      .map(f => ({
        id: `request:${f.key}`,
        kind: 'context' as const,
        role: 'user' as const,
        source: 'request',
        turn: turns,
        at,
        text: clip(f.text),
      })),
  )
}

async function push($: EngineInterface, added: TrajectoryRow[]) {
  if (added.length === 0) return
  await update($, rows, list => [...list, ...added].slice(-MAX_ROWS))
}

async function reset($: EngineInterface) {
  const [now, prompt, context] = await Promise.all([$.clock.now(), read($, systemPrompt), read($, userContext)])
  await update($, rows, () => openingRows(now, prompt, context))
  await update($, steps, () => [])
  await update($, seenReminders, () => [])
  await update($, meta, () => ({ startAt: now, turns: 0, turnStartAt: now }))
  await update($, selected, () => '')
  await update($, listTop, () => -1)
  await update($, detailTop, () => 0)
}

function matchesOf(list: TrajectoryRow[], q: string, role: TrajectoryRoleFilter) {
  const needle = q.trim().toLowerCase()
  const byRole = role === 'all' ? list : list.filter(row => row.role === role)
  if (!needle) return byRole

  return byRole.filter(row =>
    [row.kind, row.tool ?? '', row.text, row.result ?? ''].some(s => s.toLowerCase().includes(needle)),
  )
}

// Breaks text into lines of at most `width` cells, keeping its own newlines.
function wrapLines(text: string, width: number) {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    let used = 0
    for (const char of para.replace(/\t/g, '  ')) {
      const cells = cellsOf(char)
      if (used + cells > width) {
        out.push(line)
        line = ''
        used = 0
      }
      line += char
      used += cells
    }
    out.push(line)
  }

  return out
}

const topOf = (top: number, count: number, room: number) =>
  top < 0 ? Math.max(0, count - room) : Math.min(top, Math.max(0, count - room))

async function moveSelection($: EngineInterface, delta: number, room: number) {
  const [list, q, role, current, top] = await Promise.all([
    read($, rows),
    read($, query),
    read($, roleFilter),
    read($, selected),
    read($, listTop),
  ])
  const matches = matchesOf(list, q, role)
  if (matches.length === 0) return
  const at = matches.findIndex(row => row.id === current)
  const index = at < 0 ? matches.length - 1 : Math.min(matches.length - 1, Math.max(0, at + delta))
  const shownTop = topOf(top, matches.length, room)
  const nextTop = index < shownTop ? index : index >= shownTop + room ? index - room + 1 : shownTop
  await update($, selected, () => matches[index]?.id ?? '')
  await update($, detailTop, () => 0)
  await update($, listTop, () => (nextTop >= matches.length - room ? -1 : nextTop))
}

// Rows a wheel tick moves the list or the detail.
const WHEEL_STEP = 3

// The halves' sizes as last drawn, for the wheel to tell which one it is over.
// Only a hint: a reload starts it over and the next draw sets it again.
let drawn = { listRows: 0, detailRows: 0, maxLineTop: 0 }

async function scrollDetail($: EngineInterface, delta: number, maxLineTop: number) {
  await update($, detailTop, t => Math.min(maxLineTop, Math.max(0, Math.min(t, maxLineTop) + delta)))
}

async function scrollList($: EngineInterface, delta: number, room: number) {
  const [list, q, role, top] = await Promise.all([read($, rows), read($, query), read($, roleFilter), read($, listTop)])
  const count = matchesOf(list, q, role).length
  const next = Math.max(0, topOf(top, count, room) + delta)
  await update($, listTop, () => (next >= count - room ? -1 : next))
}

async function cycleRoleFilter($: EngineInterface) {
  await update($, roleFilter, was => ROLE_FILTERS[(ROLE_FILTERS.indexOf(was) + 1) % ROLE_FILTERS.length] ?? 'all')
  await update($, listTop, () => -1)
}

// JSON indented for reading; anything else, a clipped JSON among it, as it is.
const prettyOf = (text: string) => {
  const trimmed = text.trim()
  if (!/^[[{]/.test(trimmed)) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}

// A row's text and result as the detail half shows them: a tool's pretty-printed.
const shownOf = (row: TrajectoryRow) =>
  row.kind === 'tool'
    ? { text: prettyOf(row.text), result: row.result !== undefined ? prettyOf(row.result) : undefined }
    : { text: row.text, result: row.result }

// What the copy key puts on the clipboard: the row as the detail half shows it.
const copyTextOf = (row: TrajectoryRow) => {
  const { text, result } = shownOf(row)
  const head = row.tool ? `${row.tool} ${text}` : text

  return result !== undefined ? `${head}\n\n→ ${result}` : head
}

async function copyRow($: EngineInterface, row: TrajectoryRow, surface: RenderSurface) {
  const text = copyTextOf(row)
  const copied = await $.ui.copy({ text, surface })
  await $.ui.toast(
    copied.isCopied
      ? `Copied ${row.kind.toUpperCase()} (${formatTokens(text.length)} chars)`
      : `Could not copy: ${copied.reason}`,
  )
}

// A local estimate, as no token-count API reaches a mod: about four ASCII
// characters to a token, and about one token for each other character.
const estimateTokens = (text: string) => {
  let ascii = 0
  let other = 0
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) < 0x80) ascii++
    else other++
  }

  return Math.ceil(ascii / 4 + other)
}

const clockOf = (ms: number) => {
  const d = new Date(ms)

  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'trajectory',
      description: 'Show the trajectory of this session (every prompt, context, reply and tool call) in a pane',
    })
    // A reload runs session.start again: keep what the session already recorded.
    if ((await read($, rows)).length === 0) await reset($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)

    return next(e)
  })

  on('command.run', { command: 'trajectory' }, async $ => {
    // Where an organization manages Claude Code, a plugin the person installs
    // is passed over at prompt.compose: ask the engine for the prompt instead.
    if ((await read($, systemPrompt)) === null) {
      const [composed, model] = await Promise.all([$.prompt.compose(), $.session.model()])
      await recordSystemPrompt($, composed.sections, model)
    }
    // The same holds for prompt.context and prompt.attachment: read the
    // conversation as sent, and before any request the memory files on disk.
    await scanRequest($, true).catch(() => undefined)
    if ((await read($, userContext)) === null) {
      const context = await contextFromDisk($).catch(() => null)
      if (context) await recordUserContext($, context)
    }
    await $.ui.open({ id: PANE, title: 'Trajectory' })

    return { text: 'Trajectory pane opened.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    await recordSystemPrompt($, composed.sections, e.model)

    return composed
  })

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    await recordUserContext($, contextOfBlocks(result.blocks, result.instructionFiles ?? e.instructionFiles))

    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, meta, m => ({ ...m, turns: m.turns + 1, turnStartAt: now }))
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    await scanRequest($, false).catch(() => undefined)
    const { turns } = await read($, meta)
    const startAt = await $.clock.now()
    const step: TrajectoryStep = {
      turn: turns,
      startAt,
      model: e.model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    }
    await update($, steps, list => [...list, step].slice(-MAX_ROWS))

    const result = yield* next(e)

    const endAt = await $.clock.now()
    const usage = result.usage
    await update($, steps, list =>
      list.map(one =>
        one.startAt === startAt && one.turn === turns
          ? {
              ...one,
              endAt,
              model: usage?.model ?? one.model,
              input: usage?.input_tokens ?? 0,
              output: usage?.output_tokens ?? 0,
              cacheRead: usage?.cache_read_input_tokens ?? 0,
              cacheWrite: usage?.cache_creation_input_tokens ?? 0,
            }
          : one,
      ),
    )

    return result
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined || e.door === 'queue' || stored.deny !== undefined) return stored

    const { message } = stored
    const [{ turns }, at] = await Promise.all([read($, meta), $.clock.now()])
    const base = {
      turn: turns,
      at,
      role: message.role ?? ('none' as const),
      source: message.name ? `${e.door}:${message.name}` : e.door,
    }
    const blocks = message.content as Block[]

    if (e.door === 'tool-result') {
      const results = blocks.filter(b => b.type === 'tool_result')
      if (results.length > 0) {
        const byId = new Map(results.map(b => [String(b.tool_use_id), b]))
        await update($, rows, list =>
          list.map(row => {
            const b = byId.get(row.id)
            if (!b) return row

            return {
              ...row,
              endAt: row.endAt ?? at,
              result: clip(textOf(b.content)),
              isError: b.is_error === true,
            }
          }),
        )

        return stored
      }
    }

    if (message.type === 'assistant') {
      const added: TrajectoryRow[] = []
      blocks.forEach((b, i) => {
        if (b.type === 'text' && String(b.text ?? '').trim() !== '') {
          added.push({ ...base, id: `${stored.uuid}:${i}`, kind: 'assistant', text: clip(String(b.text)) })
        } else if (b.type === 'thinking' && String(b.thinking ?? '').trim() !== '') {
          added.push({ ...base, id: `${stored.uuid}:${i}`, kind: 'thinking', text: clip(String(b.thinking)) })
        } else if (b.type === 'tool_use') {
          added.push({
            ...base,
            id: String(b.id),
            kind: 'tool',
            tool: String(b.name),
            text: clip(JSON.stringify(b.input ?? {})),
          })
        }
      })
      await push($, added)

      return stored
    }

    const text = textOf(message.content)
    if (text.trim() === '') return stored

    const isUser = (e.door === 'prompt' || e.door === 'command') && message.isMeta !== true
    const kind: TrajectoryKind = isUser
      ? 'user'
      : e.door === 'notice' || e.door === 'compaction'
        ? 'system'
        : 'context'
    const label = message.name && !isUser ? `[${message.name}] ` : ''
    await push($, [{ ...base, id: stored.uuid, kind, text: clip(label + text) }])

    return stored
  })

  on('tool.call', async ($, e, next) => {
    const startAt = await $.clock.now()
    await update($, rows, list => list.map(row => (row.id === e.tool_use_id ? { ...row, at: startAt } : row)))
    const ran = await next(e)
    const endAt = await $.clock.now()
    await update($, rows, list => list.map(row => (row.id === e.tool_use_id ? { ...row, endAt } : row)))

    return ran
  })

  // The pane draws its own two windows, so the wheel moves them, never the body.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { listRows, detailRows, maxLineTop } = drawn
    if (listRows === 0) return {}
    // The search field's height is the surface's: what the tree has beyond the rest.
    const searchRows = Math.max(0, e.contentRows - (CHROME_ROWS - 2 + listRows + detailRows))
    const detailStart = 1 + searchRows + 5 + listRows + 1
    const delta = e.pointer ? e.by * WHEEL_STEP : e.by
    if (e.pointer && e.pointer.row >= detailStart) await scrollDetail($, delta, maxLineTop)
    else await scrollList($, delta, listRows)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Mobile draws no text field: search is left out there.
    const Input = 'Input' in elements ? elements.Input : undefined
    const [list, stepList, m, currentMode, q, currentRole, current, top, lineTop, now] = await Promise.all([
      read($, rows),
      read($, steps),
      read($, meta),
      read($, mode),
      read($, query),
      read($, roleFilter),
      read($, selected),
      read($, listTop),
      read($, detailTop),
      $.clock.now(),
    ])
    const width = Math.max(40, e.props.bodyColumns)

    // Minimap: each lane is a row of cells, each cell the color of what sits there.
    const lanes = { Input: [] as (ThemeKey | undefined)[], Model: [] as (ThemeKey | undefined)[], Tools: [] as (ThemeKey | undefined)[] }
    const cols = Math.max(10, width - MINIMAP_LABEL)
    for (const lane of Object.values(lanes)) lane.length = cols
    const laneOf = (kind: TrajectoryKind) =>
      kind === 'tool' ? lanes.Tools : kind === 'assistant' || kind === 'thinking' ? lanes.Model : lanes.Input
    const paint = (lane: (ThemeKey | undefined)[], from: number, to: number, color: ThemeKey) => {
      const a = Math.min(cols - 1, Math.max(0, Math.floor(from * cols)))
      const b = Math.min(cols - 1, Math.max(a, Math.ceil(to * cols) - 1))
      for (let i = a; i <= b; i++) lane[i] = color
    }

    if (currentMode === 'duration') {
      const span = Math.max(1, now - m.startAt)
      const x = (t: number) => (t - m.startAt) / span
      for (const row of list) {
        if (row.kind === 'assistant' || row.kind === 'thinking') continue
        paint(laneOf(row.kind), x(row.at), x(row.endAt ?? row.at), COLORS[row.kind])
      }
      for (const step of stepList) paint(lanes.Model, x(step.startAt), x(step.endAt ?? now), COLORS.assistant)
    } else if (currentMode === 'turns') {
      const buckets = m.turns + 1
      const perTurn = new Map<number, TrajectoryRow[]>()
      for (const row of list) perTurn.set(row.turn, [...(perTurn.get(row.turn) ?? []), row])
      for (const [turn, inTurn] of perTurn) {
        inTurn.forEach((row, j) => {
          const from = (turn + j / inTurn.length) / buckets
          paint(laneOf(row.kind), from, from + 0.5 / (buckets * inTurn.length), COLORS[row.kind])
        })
      }
    } else {
      // Calls: one slot per row, with a gap between slots when there is room.
      const slot = cols / Math.max(1, list.length)
      list.forEach((row, i) => {
        const from = (i * slot) / cols
        paint(laneOf(row.kind), from, from + Math.max(1, slot - 1) / cols, COLORS[row.kind])
      })
    }

    const drawLane = (name: string, lane: (ThemeKey | undefined)[]) => {
      const runs: { color?: ThemeKey; text: string }[] = []
      for (const color of lane) {
        const last = runs[runs.length - 1]
        const char = color ? MARK : ' '
        if (last && last.color === color) last.text += char
        else runs.push({ color, text: char })
      }

      return (
        <Box key={`lane-${name}`} flexDirection="row">
          <Text dimColor>{name.padEnd(MINIMAP_LABEL)}</Text>
          {runs.map(run => (run.color ? <Text color={run.color}>{run.text}</Text> : <Text>{run.text}</Text>))}
        </Box>
      )
    }

    // The body splits in two: the list of rows above, the selected row's detail below.
    const room = Math.max(6, (e.props.scroll?.bodyRows ?? 30) - CHROME_ROWS)
    const listRows = Math.ceil(room / 2)
    const detailRows = room - listRows

    const needle = q.trim().toLowerCase()
    const matches = matchesOf(list, q, currentRole)
    const shownTop = topOf(top, matches.length, listRows)
    const shown = matches.slice(shownTop, shownTop + listRows)
    const textWidth = width - GUTTER - BADGE - ROLE_WIDTH - 1

    const summaryOf = (row: TrajectoryRow) => {
      if (row.title !== undefined) return row.title
      if (row.kind !== 'tool') return oneLine(row.text)
      const input = fit(oneLine(row.text), Math.max(12, Math.floor(textWidth / 3)))
      const took = row.endAt !== undefined ? ` ${formatMs(row.endAt - row.at)}` : ' …'
      const result = row.result !== undefined ? ` → ${oneLine(row.result)}` : ''

      return `${row.tool} ${input}${took}${result}`
    }
    const badgeOf = (row: TrajectoryRow) => (row.kind === 'tool' && row.isError ? 'TOOL ✗' : row.kind.toUpperCase())
    const colorOf = (row: TrajectoryRow): ThemeKey => (row.kind === 'tool' && row.isError ? 'error' : COLORS[row.kind])

    let lastTurn = shownTop > 0 ? (matches[shownTop - 1]?.turn ?? -1) : -1
    const lines = shown.map(row => {
      const gutter = row.turn !== lastTurn && row.turn > 0 ? `T${row.turn}` : ''
      lastTurn = row.turn
      const isSelected = current === row.id

      return (
        <Button
          key={`press-${row.id}`}
          plain
          onPress={async () => {
            await update($, selected, was => (was === row.id ? '' : row.id))
            await update($, detailTop, () => 0)
          }}
        >
          <Text dimColor>{(isSelected ? '▶' : gutter).padEnd(GUTTER)}</Text>
          <Text color={colorOf(row)} bold>
            {badgeOf(row).padStart(BADGE - 1)}
          </Text>{' '}
          <Text dimColor>{roleLabelOf(row.role).padEnd(ROLE_WIDTH)}</Text>
          <Text dimColor={row.kind === 'thinking' || row.role === 'none'} inverse={isSelected}>
            {fit(summaryOf(row), textWidth)}
          </Text>
        </Button>
      )
    })
    const listFiller = Array.from({ length: listRows - lines.length }, () => <Text> </Text>)

    // Detail: the selected row whole, wrapped to the pane and windowed.
    const picked = matches.find(row => row.id === current) ?? list.find(row => row.id === current)
    const bodyWidth = Math.max(10, width - 1)
    const detail: { text: string; tone?: 'result' | 'error' }[] = []
    if (picked) {
      const { text: body, result } = shownOf(picked)
      for (const text of wrapLines(body, bodyWidth)) detail.push({ text })
      if (result !== undefined) {
        detail.push({ text: '' })
        const tone = picked.isError ? 'error' : 'result'
        for (const text of wrapLines(`→ ${result}`, bodyWidth)) detail.push({ text, tone })
      }
    }
    const maxLineTop = Math.max(0, detail.length - detailRows)
    const firstLine = Math.min(lineTop, maxLineTop)
    const detailShown = detail.slice(firstLine, firstLine + detailRows)
    const pickedInfo = picked
      ? [
          picked.tool,
          picked.role === undefined
            ? 'role unknown'
            : picked.role === 'none'
              ? 'not sent to the model'
              : `role: ${picked.role}`,
          picked.source,
          picked.turn > 0 ? `Turn ${picked.turn}` : '',
          clockOf(picked.at),
          picked.endAt !== undefined ? formatMs(picked.endAt - picked.at) : '',
          detail.length > detailRows
            ? `${firstLine + 1}-${firstLine + detailShown.length}/${detail.length} lines`
            : `${detail.length} lines`,
          `≈${formatTokens(estimateTokens(picked.text + (picked.result ?? '')))} tok`,
        ]
          .filter(Boolean)
          .join(' · ')
      : 'Select a row to see it whole here'
    const detailFiller = Array.from({ length: detailRows - detailShown.length }, () => <Text> </Text>)
    drawn = { listRows, detailRows, maxLineTop }

    // Footer: what the session cost, as the steps report it.
    const tokens = stepList.reduce((n, s) => n + s.input + s.output + s.cacheRead + s.cacheWrite, 0)
    const inputSide = stepList.reduce((n, s) => n + s.input + s.cacheRead + s.cacheWrite, 0)
    const cacheRead = stepList.reduce((n, s) => n + s.cacheRead, 0)
    const output = stepList.reduce((n, s) => n + s.output, 0)
    const modelMs = stepList.reduce((n, s) => n + (s.endAt !== undefined ? s.endAt - s.startAt : 0), 0)
    const toolCalls = list.filter(row => row.kind === 'tool').length
    const footer = [
      `${m.turns} turns`,
      `${stepList.length} steps`,
      `${toolCalls} calls`,
      modelMs > 0 ? `${Math.round(output / (modelMs / 1000))} tok/s` : '',
      `${formatTokens(tokens)} tok`,
      inputSide > 0 ? `cache hit ${Math.round((cacheRead / inputSide) * 100)}%` : '',
      formatMs(now - m.startAt),
    ]
      .filter(Boolean)
      .join(' · ')

    const modeButton = (value: TrajectoryMode, label: string, hotkey: string) => (
      <Button key={`mode-${value}`} plain hotkey={hotkey} onPress={() => update($, mode, () => value)}>
        <Text bold={currentMode === value} color={currentMode === value ? 'suggestion' : undefined} dimColor={currentMode !== value}>
          {label}
        </Text>
      </Button>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          {modeButton('duration', 'Duration', 'd')}
          {modeButton('turns', 'Turns', 't')}
          {modeButton('calls', 'Calls', 'c')}
          <Button key="role-filter" plain hotkey="r" onPress={() => cycleRoleFilter($)}>
            <Text dimColor={currentRole === 'all'} color={currentRole === 'all' ? undefined : 'suggestion'} bold={currentRole !== 'all'}>
              role: {currentRole}
            </Text>
          </Button>
          <Text dimColor>
            {needle || currentRole !== 'all' ? `${matches.length}/${list.length}` : `${list.length}`} rows
          </Text>
          <Box flexGrow={1} />
          {shownTop > 0 && (
            <Button key="list-up" plain onPress={() => scrollList($, -(listRows - 1), listRows)}>
              <Text dimColor>▲ {shownTop} earlier</Text>
            </Button>
          )}
          {top >= 0 && (
            <Button key="list-latest" plain hotkey="g" onPress={() => scrollList($, matches.length, listRows)}>
              <Text dimColor>latest ▼</Text>
            </Button>
          )}
        </Box>
        {Input && (
          <Input
            key="search"
            placeholder="Search"
            value={q}
            onInput={(value: string) => update($, query, () => value)}
            onSubmit={(value: string) => update($, query, () => value)}
          />
        )}
        <Box flexDirection="column" marginY={1}>
          {drawLane('Input', lanes.Input)}
          {drawLane('Model', lanes.Model)}
          {drawLane('Tools', lanes.Tools)}
        </Box>
        <Box key="list" flexDirection="column">
          {shown.length === 0 && <Text dimColor>{needle ? 'No rows match.' : 'Nothing recorded yet.'}</Text>}
          {lines}
          {listFiller}
        </Box>
        <Box key="divider" flexDirection="row" gap={1}>
          {picked && (
            <Text color={colorOf(picked)} bold>
              {badgeOf(picked)}
            </Text>
          )}
          <Text dimColor>{pickedInfo}</Text>
          <Box flexGrow={1} />
          {picked && (
            <Button key="copy" plain hotkey="y" onPress={press => copyRow($, picked, press.surface)}>
              <Text dimColor>copy</Text>
            </Button>
          )}
          <Button key="prev" plain hotkey="k" onPress={() => moveSelection($, -1, listRows)}>
            <Text dimColor>prev</Text>
          </Button>
          <Button key="next" plain hotkey="j" onPress={() => moveSelection($, 1, listRows)}>
            <Text dimColor>next</Text>
          </Button>
          <Button key="detail-up" plain hotkey="p" onPress={() => scrollDetail($, -(detailRows - 1), maxLineTop)}>
            <Text dimColor>▲</Text>
          </Button>
          <Button key="detail-down" plain hotkey="n" onPress={() => scrollDetail($, detailRows - 1, maxLineTop)}>
            <Text dimColor>▼</Text>
          </Button>
        </Box>
        <Box key="detail" flexDirection="column">
          {detailShown.map(line => (
            <Text
              color={line.tone === 'error' ? 'error' : undefined}
              dimColor={line.tone === 'result'}
            >
              {line.text === '' ? ' ' : line.text}
            </Text>
          ))}
          {detailFiller}
        </Box>
        <Box>
          <Text dimColor>{footer}</Text>
        </Box>
      </Box>
    )
  })
}
