// Loader: rewrite extensionless local imports to .ts when imported
// from any server/**/*.ts file. The test runtime
// (node --experimental-strip-types) does not auto-resolve .ts
// extensions, but the project's source files all import siblings
// without extensions.
//
// Specifier rule: starts with './' and has no '.ts' suffix. This
// covers './roadmap', './prompts/index', './routes/terms',
// './routes/index', './lib/http', etc.
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && /\/server\/.+\.ts$/.test(context.parentURL) && /^\.\//.test(specifier) && !/\.ts$/.test(specifier)) {
    return nextResolve(specifier + '.ts', context)
  }
  return nextResolve(specifier, context)
}
