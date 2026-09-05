// server/lib/run-card.d.mts
export interface RunCardOpts {
  stPath: string; wt: string; branch: string; repo: string; prompt: string
  baseBranch?: string; exe: string; args: string[]; env: NodeJS.ProcessEnv
  logWs: { write(chunk: Buffer | string): boolean; end(): void }
  pane?: number | string | null
  pidPath?: string  // ponytail: card super-prompt-loop — optional PID file write (BC-safe additive)
}
export function runCard(opts: RunCardOpts): Promise<number>
export function runHermesHeadless(opts: {
  exe: string; args: string[]; env: NodeJS.ProcessEnv
  logWs: { write(chunk: Buffer | string): boolean; end(): void }
}): Promise<number>
