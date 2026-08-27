// Notificações do navegador.
// REGRA: requestPermission tem de ser chamado DENTRO de um user gesture (click),
// senão os browsers modernos negam silenciosamente e bloqueiam a origem para sempre.
// Usar sempre as funções daqui; nunca `Notification.requestPermission()` solto.
export type NotifState = NotificationPermission

export function notifState(): NotifState {
  return 'Notification' in window ? Notification.permission : 'denied'
}

// Chama SÓ a partir de um handler de click/tap. Retorna a permissão atual.
export async function requestNotifs(): Promise<NotifState> {
  if (!('Notification' in window)) return 'denied'
  try { return await Notification.requestPermission() } catch { return 'denied' }
}

export function canNotify(): boolean {
  return 'Notification' in window && Notification.permission === 'granted'
}

// Dispara uma notif nativa (no-op sem permissão). Também mostra um toast.
import { toast } from './toast'
export function notify(title: string, body: string) {
  toast(body)
  if (!canNotify()) return
  try { new Notification(title, { body }) } catch { /* ctor ausente */ }
}
