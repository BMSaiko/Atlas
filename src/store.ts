// minimal pub/sub store
export function createStore<T>(init: T) {
  let state = init
  const subs = new Set<() => void>()
  return {
    get(): T { return state },
    set(v: T) { state = v; subs.forEach(f => f()) },
    sub(f: () => void) { subs.add(f); return () => subs.delete(f) },
  }
}
