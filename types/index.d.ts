export type TrajectoryKind = 'system' | 'user' | 'context' | 'assistant' | 'thinking' | 'tool'

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

export type TrajectoryMode = 'duration' | 'turns' | 'calls'

declare module 'claude-code' {
  interface PluginState {
    trajectory: {
      rows: TrajectoryRow[]
      steps: TrajectoryStep[]
      meta: TrajectoryMeta
      mode: TrajectoryMode
      query: string
      /** The row the detail half shows; '' for none. */
      selected: string
      /** The first row the list half shows; -1 follows the newest. */
      listTop: number
      /** The first line the detail half shows. */
      detailTop: number
    }
  }
}
