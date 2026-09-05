import {
  Circle, Play, MessageSquare, Plus, FileText, BookOpen, KanbanSquare, Settings, Pencil, Trash2,
  Archive, Search, ChevronRight, ChevronLeft, Menu, MoveHorizontal, Check, Filter, Sparkles,
  Sun, Sunset, Moon, Timer, Pause, RotateCcw, Leaf, Bell, Tag, BellOff, Terminal, Snowflake,
  Sprout, Cloud, CloudFog, CloudRain, CloudLightning, Power, Calendar, type LucideIcon,
} from 'lucide-react'
import * as React from 'react'

// ponytail: string-based API that maps old ICON names to lucide. Callers don't refactor.
const M: Record<string, LucideIcon> = {
  sphere: Circle,
  play: Play,
  chat: MessageSquare,
  plus: Plus,
  note: FileText,
  doc: BookOpen,
  board: KanbanSquare,
  gear: Settings,
  pencil: Pencil,
  trash: Trash2,
  archive: Archive,
  search: Search,
  forward: ChevronRight,
  back: ChevronLeft,
  menu: Menu,
  move: MoveHorizontal,
  check: Check,
  filter: Filter,
  aura: Sparkles,
  sun: Sun,
  dusk: Sunset,
  moon: Moon,
  timer: Timer,
  pause: Pause,
  reset: RotateCcw,
  leaf: Leaf,
  bell: Bell,
  tag: Tag,
  bellOff: BellOff,
  term: Terminal,
  snow: Snowflake,
  sprout: Sprout,
  cloud: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  storm: CloudLightning,
  kill: Power,
  // ponytail: SP atlas-calendar-2026-09-05 — sidebar item for the calendar route
  cal: Calendar,
  icon: Circle,
}

export function Icon({ name, size = 16, className }: { name: keyof typeof M; size?: number; className?: string }) {
  const C = M[name] ?? Circle
  return <C size={size} className={className} aria-hidden="true" strokeWidth={1.5} />
}

// ponytail: escape hatch for legacy string-template code that still uses `${icon('x', n)}`
// Returns the rendered <svg> string. Routes through ReactDOMServer to renderToString.
import { renderToStaticMarkup } from 'react-dom/server'
export function icon(name: keyof typeof M, size = 20): string {
  return renderToStaticMarkup(<Icon name={name} size={size} />)
}
