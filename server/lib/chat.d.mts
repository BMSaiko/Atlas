// server/lib/chat.d.mts
// Type declarations for server/lib/chat.mjs (cross-mundo main chat store + runner).
export const CAP: number

export interface ChatMsg {
  role: 'user' | 'agent'
  text: string
  ts: number
  runId?: string
  actions?: any[]
}

export function readHistory(dataDir: string): Promise<{ messages: ChatMsg[] }>
export function appendHistory(dataDir: string, msg: ChatMsg): Promise<{ messages: ChatMsg[] }>
export function clearHistory(dataDir: string): Promise<void>

export interface LaunchChatOpts {
  dataDir: string
  cfg: { port: number; hermesPy: string; hermesHome: string; wtoken: string }
  userMsg: string
  history: ChatMsg[]
  worlds: any[]
}

export interface LaunchedChat {
  runId: string
  logPath: string
  stPath: string
}

export function launchChat(opts: LaunchChatOpts): Promise<LaunchedChat>

export interface BuildPromptOpts {
  userMsg: string
  history: ChatMsg[]
  worlds: any[]
  apiBase: string
  atlasToken: string
  logPath: string
}

export function buildPrompt(opts: BuildPromptOpts): Promise<string>
