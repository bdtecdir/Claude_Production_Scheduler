/**
 * Directed-graph utilities: topological sort (Kahn) with cycle extraction.
 */

export class CycleError extends Error {
  /** Node ids forming the cycle, first id repeated at the end. */
  readonly cycle: string[];

  constructor(cycle: string[], labelFor: (id: string) => string = (id) => id) {
    super(
      `Circular dependency detected: ${cycle.map(labelFor).join(' → ')}. ` +
        'Remove one of these links (or the parent/subtask relationship) to continue.',
    );
    this.name = 'CycleError';
    this.cycle = cycle;
  }
}

export type AdjacencyList = Map<string, Set<string>>;

export function addEdge(graph: AdjacencyList, from: string, to: string): void {
  if (!graph.has(from)) graph.set(from, new Set());
  if (!graph.has(to)) graph.set(to, new Set());
  graph.get(from)!.add(to);
}

/**
 * Returns node ids in dependency order (every edge from → to has `from`
 * before `to`). Ties are broken by the order of `nodes` so output is
 * deterministic. Throws CycleError naming one concrete cycle.
 */
export function topologicalSort(
  nodes: readonly string[],
  graph: AdjacencyList,
  labelFor?: (id: string) => string,
): string[] {
  const indegree = new Map<string, number>();
  for (const id of nodes) indegree.set(id, 0);
  for (const [, targets] of graph) {
    for (const t of targets) indegree.set(t, (indegree.get(t) ?? 0) + 1);
  }

  const rank = new Map(nodes.map((id, i) => [id, i]));
  const ready = nodes.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];

  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    const newlyReady: string[] = [];
    for (const t of graph.get(id) ?? []) {
      const d = indegree.get(t)! - 1;
      indegree.set(t, d);
      if (d === 0) newlyReady.push(t);
    }
    if (newlyReady.length) {
      ready.push(...newlyReady);
      ready.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    }
  }

  if (order.length < indegree.size) {
    const remaining = new Set([...indegree.keys()].filter((id) => indegree.get(id)! > 0));
    throw new CycleError(findCycle(remaining, graph), labelFor);
  }
  return order;
}

/** DFS restricted to `candidates` (nodes Kahn could not drain). */
function findCycle(candidates: Set<string>, graph: AdjacencyList): string[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    state.set(id, 'visiting');
    stack.push(id);
    for (const next of graph.get(id) ?? []) {
      if (!candidates.has(next)) continue;
      if (state.get(next) === 'visiting') {
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (!state.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const id of candidates) {
    if (!state.has(id)) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return [...candidates];
}
