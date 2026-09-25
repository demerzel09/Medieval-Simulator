import content from "../content/scenario.json";
export function route(
  from: string,
  to: string,
): { distance: number; path: string[] } {
  const dist: Record<string, number> = { [from]: 0 },
    paths: Record<string, string[]> = { [from]: [from] },
    done = new Set<string>();
  while (true) {
    const node = Object.keys(dist)
      .filter((x) => !done.has(x))
      .sort((a, b) => dist[a] - dist[b] || a.localeCompare(b))[0];
    if (!node) throw Error("道がない");
    if (node === to) return { distance: dist[node], path: paths[node] };
    done.add(node);
    for (const [a, b, d] of content.roads) {
      const next = a === node ? String(b) : b === node ? String(a) : undefined;
      if (next) {
        const n = dist[node] + Number(d);
        if (dist[next] === undefined || n < dist[next]) {
          dist[next] = n;
          paths[next] = [...paths[node], next];
        }
      }
    }
  }
}
