// Loader: rewrite extensionless ./roadmap|./config|./prompts/index -> .ts when imported from api.ts
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && /\/server\/api\.ts$/.test(context.parentURL) && /roadmap|config|prompts\/index|snapshots/.test(specifier)) {
    return nextResolve(specifier + '.ts', context)
  }
  return nextResolve(specifier, context)
}
