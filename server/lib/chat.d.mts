// server/lib/chat.d.mts
// Type declarations for server/lib/chat.mjs (multi-conversation chat store + runner).
export const CAP: number

export interface ChatMsg {
  role: 'user' | 'agent'
  text: string
  ts: number
  runId?: string
  actions?: any[]
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMsg[]
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  msgCount: number
}

export interface ChatState {
  conversation: Conversation
  messages: ChatMsg[]
  conversations: Conversation[]
  current: string
}

export interface ChatConversationsList {
  current: string
  conversations: ConversationSummary[]
}

export function readHistory(dataDir: string): Promise<ChatState>
export function appendHistory(dataDir: string, msg: ChatMsg): Promise<ChatState>
export function clearHistory(dataDir: string): Promise<void>
export function newConversation(dataDir: string): Promise<ChatState>
export function switchConversation(dataDir: string, id: string): Promise<ChatState | null>
export function listConversations(dataDir: string): Promise<ConversationSummary[]>
export function deleteConversation(dataDir: string, id: string): Promise<ChatConversationsList | null>

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
