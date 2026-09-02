// server/lib/types.ts
//
// ponytail: shared domain types. Start with WD (workdir descriptor).
// Add here only when 2+ files need the same shape; single-file types
// stay local.

export interface WD {
  slug: string
  name: string
  description: string
  createdAt: number
  icon?: string
  repo?: string
}
