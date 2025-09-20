// Collapsible Graph Manager
export function createCollapsibleGraph(
  nodes: any[],
  links: any[],
  rootId: string = "Now",
) {
  const nodesById = Object.fromEntries(
    nodes.map((n) => [n.id, { ...n, collapsed: true, childLinks: [] }]),
  );

  links.forEach((l) => {
    const srcId = l.source;
    if (nodesById[srcId]) nodesById[srcId].childLinks.push(l);
  });

  // traversal
  function getPrunedGraph() {
    const visibleNodes: any[] = [];
    const visibleLinks: any[] = [];

    function traverse(node: any) {
      console.log("NODE: ", node);
      if (!node || visibleNodes.includes(node)) return;
      visibleNodes.push(node);

      if (node.collapsed) return;

      node.childLinks.forEach((link: any) => {
        console.log("LINK: ", link.target);
        visibleLinks.push(link);
        const child =
          nodesById[
            typeof link.target == "object" ? link.target.id : link.target
          ];
        traverse(child);
      });
    }
    console.log("NODES LIST: ", nodesById);
    traverse(nodesById[rootId]);
    return { nodes: visibleNodes, links: visibleLinks };
  }

  // toggle collapse on click
  function toggleNode(id: string) {
    if (!nodesById[id]) return;
    nodesById[id].collapsed = !nodesById[id].collapsed;
  }

  return { nodesById, getPrunedGraph, toggleNode };
}
