// Loader: rewrite extensionless local imports to .ts when imported from
// any server/*.ts file. The test runtime (node --experimental-strip-types)
// does not auto-resolve .ts extensions, but the project's source files
// (api.ts, routes.ts, and future server/routes/*.ts) all import
// siblings without extensions. Sub-path imports (./prompts/index) are
// also allowed.
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && /\/server\/[^/]+\.ts$/.test(context.parentURL) && /^\.\/[^.]*$/.test(specifier)) {
    return nextResolve(specifier + '.ts', context)
  }
  return nextResolve(specifier, context)
}
