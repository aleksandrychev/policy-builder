const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

// Equal down to `depth` levels of plain objects and arrays; any two functions count as equal.
export function sameShape(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (depth === 0) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => sameShape(item, b[index], depth - 1));
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => key in b && sameShape(a[key], b[key], depth - 1));
}

/**
 * React Flow re-renders a node or edge whenever its object changes. These are rebuilt on every
 * canvas render, so each is swapped for last call's object when nothing in it changed (three
 * levels deep, callbacks ignored). The callbacks must only capture what the item itself holds,
 * and reach the canvas's handlers through a latest-ref (useLatest), or a reused one goes stale.
 * Create one per list and keep it for the component's life: `useState(() => stableItems())`.
 */
export function stableItems<T extends { id: string }>(): (items: T[]) => T[] {
  let previous = new Map<string, T>();
  return items => {
    const stable = items.map(item => {
      const before = previous.get(item.id);
      return before && sameShape(before, item, 3) ? before : item;
    });
    previous = new Map(stable.map(item => [item.id, item]));
    return stable;
  };
}
