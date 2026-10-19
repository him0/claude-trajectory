export type TrajectoryKind = 'system' | 'user' | 'context' | 'assistant' | 'thinking' | 'tool'

/**
 * Under which role a request carries the row: `system` for the system prompt,
 * `none` for a row no request carries (a notice, a record the model never reads).
 */
export type TrajectoryRole = 'system' | 'user' | 'assistant' | 'none'

export type TrajectoryRoleFilter = TrajectoryRole | 'all'

export type TrajectoryRow = {
  id: string
  kind: TrajectoryKind
  /** The main-loop turn the row belongs to; 0 before the first turn. */
  turn: number
  /** When the row was appended, in ms since the epoch. */
  at: number
  /** When a tool call finished, in ms since the epoch. */
  endAt?: number
  /** The tool's name, on a tool row. */
  tool?: string
  /** Absent on rows recorded before roles were kept. */
  role?: TrajectoryRole
  /** The door the row came in by, and its attachment or notice name. */
  source?: string
  /** The one-line summary drawn in place of `text`, when the row has one. */
  title?: string
  /** The row's text: a message, a tool call's input as JSON, the system prompt. */
  text: string
  /** A tool call's result. */
  result?: string
  isError?: boolean
}

export type TrajectoryStep = {
  turn: number
  startAt: number
  endAt?: number
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type TrajectoryMeta = {
  startAt: number
  turns: number
  turnStartAt: number
}

/** The first system prompt the session composed, as the system row shows it. */
export type TrajectorySystemPrompt = {
  title: string
  text: string
}

/** The context blocks of the first user message, as the context row shows them. */
export type TrajectoryUserContext = {
  title: string
  text: string
}

export type TrajectoryMode ='duration' | 'turns' | 'calls'

declare module 'claude-code' {
  interface PluginState {
    trajectory: {
      rows: TrajectoryRow[]
      steps: TrajectoryStep[]
      meta: TrajectoryMeta
      mode: TrajectoryMode
      query: string
      roleFilter: TrajectoryRoleFilter
      /** The row the detail half shows; '' for none. */
      selected: string
      /** The first row the list half shows; -1 follows the newest. */
      listTop: number
      /** The first line the detail half shows. */
      detailTop: number
      /** null until the engine composes a system prompt. */
      systemPrompt: TrajectorySystemPrompt | null
      /** null until the engine computes the first message's context blocks. */
      userContext: TrajectoryUserContext | null
      /** Where each reminder already made a row stands: replies before it, hash, occurrence. */
      seenReminders: string[]
    }
  }
}
