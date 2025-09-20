interface Link {
  source: { id: string };
  target: { id: string };
}

/**
 * Compute the path from `nodeID` back through sources until "Now".
 */
export function getHighlightPath(nodeID: string, links: Link[]): string[] {
  // build adjacency map: target -> list of sources
  const map = new Map<string, string[]>();
  links.forEach((link) => {
    map.set(link.target.id, [
      link.source.id,
      ...(map.get(link.target.id) ?? []),
    ]);
  });

  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    if (visited.has(node)) return false;
    visited.add(node);
    path.push(node);

    if (node === "Now") return true;

    const sources = map.get(node) ?? [];
    for (const src of sources) {
      if (dfs(src)) return true;
    }
    // backtrack if this branch doesn’t reach "Now"
    path.pop();
    return false;
  }

  dfs(nodeID);
  return path;
}
