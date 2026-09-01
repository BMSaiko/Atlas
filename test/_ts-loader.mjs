// Loader: rewrite extensionless ./roadmap|./config -> .ts when imported from api.ts
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && /\/server\/api\.ts$/.test(context.parentURL) && /roadmap|config/.test(specifier)) {
    return nextResolve(specifier + '.ts', context)
  }
  return nextResolve(specifier, context)
}
