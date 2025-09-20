"use client";

import type { User } from "next-auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { getHighlightPath } from "./highlight";
import { createSimpleGraph } from "./pruned";

interface Node {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  fx?: number;
  fy?: number;
  fz?: number;
}

interface Link {
  id: string;
  source: string;
  target: string;
  timeInMonths?: number;
}

interface Config {
  prompt: string;
  positivity: number;
  time_in_months: number;
  type: string;
  num_nodes: number;
}

interface LifeProps {
  user: User;
  setHighlightedPath?: (path: string[]) => void;
  nodes: Node[];
  links: Link[];
  handleNodeClick: (nodeId: string) => void;
}

export default function Life({
  user: _user,
  setHighlightedPath,
  nodes,
  links,
  handleNodeClick,
}: LifeProps) {
  const [isMounted, setIsMounted] = useState(false);
  const fgRef = useRef<any>({});
  const highlightRef = useRef<string[]>([]);
  const hoverRef = useRef<string>("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const containerRef = useCallback((node: HTMLDivElement) => {
    // Check if the node is being mounted
    if (node !== null) {
      // The node exists! Update state to trigger a re-render.
      setSize({ width: node.offsetWidth, height: node.offsetHeight });
    }
  }, []);

  // Memoize node colors to prevent them from changing on hover
  const nodeColors = useMemo(() => {
    const colors: { [nodeId: string]: string } = {};
    nodes.forEach((node) => {
      if (node.id === "Now") {
        colors[node.id] = "yellow";
      } else {
        const hasOutgoingLinks = links.some((link) => link.source === node.id);
        colors[node.id] = hasOutgoingLinks ? "red" : "green";
      }
    });
    console.log("Calculated node colors:", colors);
    return colors;
  }, [nodes, links]);

  const [graphData, setGraphData] = useState(() =>
    createSimpleGraph(nodes, links),
  );

  // Update graph data when nodes or links change
  useEffect(() => {
    console.log(
      "Updating graph with nodes:",
      nodes.length,
      "links:",
      links.length,
    );
    const newGraphData = createSimpleGraph(nodes, links);
    console.log("Graph data for ForceGraph:", newGraphData);
    setGraphData(newGraphData);
  }, [nodes, links]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <div>Loading...</div>;
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      {size.width > 0 && size.height > 0 && (
        <ForceGraph
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          key={`graph-${nodes.length}-${links.length}`}
          onNodeClick={(node: any, event: any) => {
            console.log("Node clicked in ForceGraph:", node.id, node);
            console.log("Shift key held:", event?.shiftKey);

            // Only generate new nodes if shift key is held
            if (event?.shiftKey) {
              console.log(
                "Shift+Click: Calling handleNodeClick with:",
                node.id,
              );
              handleNodeClick(node.id);
            } else {
              console.log(
                "Normal click: Will open info pane (not implemented yet)",
              );
              // TODO: Open info pane for this node
            }
          }}
          nodeThreeObjectExtend={false}
          nodeThreeObject={(node: any) => {
            const group = new THREE.Group();

            // Use the memoized color that won't change on hover
            const color = nodeColors[node.id] || "green";

            // === Base size from nodeVal logic ===
            const radius = node.id === "Now" ? 10 : 4;

            // === Node body ===
            const geometry = new THREE.SphereGeometry(radius, 32, 32);
            const material = new THREE.MeshStandardMaterial({
              color: color,
              roughness: 0.4,
              metalness: 0.6,
            });
            const sphere = new THREE.Mesh(geometry, material);
            group.add(sphere);

            // === Highlight effect (hover or special node) ===
            if (highlightRef.current.includes(node.id)) {
              // --- Glow ---
              const glowGeometry = new THREE.SphereGeometry(radius * 2, 32, 32);
              const glowMaterial = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: node.id == hoverRef.current ? 1 : 0.25,
              });
              const glow = new THREE.Mesh(glowGeometry, glowMaterial);
              group.add(glow);

              // --- Ring ---
              const ringGeometry = new THREE.TorusGeometry(
                radius * 2.2,
                radius * 0.2,
                16,
                100,
              );
              const ringMaterial = new THREE.MeshBasicMaterial({
                color: "white",
                transparent: true,
                opacity: 0.8,
              });
              const ring = new THREE.Mesh(ringGeometry, ringMaterial);
              ring.rotation.x = Math.PI / 2; // lay flat
              group.add(ring);
            }

            // === Label ===
            const sprite = new SpriteText(node.id);
            sprite.color = "white";
            sprite.textHeight = radius * 1.5;
            sprite.center.set(0.5, 0);
            sprite.position.set(0, radius * 2.2, 0);
            group.add(sprite);

            return group;
          }}
          nodeVal={(node) => (node.id === "Now" ? 50 : 4)}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.6}
          enableNodeDrag={true}
          onNodeDrag={(node) => {
            // Prevent dragging of "Now" node only
            if (node.id === "Now") {
              node.fx = 0;
              node.fy = 0;
              node.fz = 0;
              return false;
            }
            // Allow dragging for all other nodes
            return true;
          }}
          onNodeHover={(node: any) => {
            if (!node && hoverRef.current) {
              hoverRef.current = "";
            } else if (node && !hoverRef.current) {
              hoverRef.current = node.id;
              const highlightPath = getHighlightPath(node.id, graphData.links);
              highlightRef.current = highlightPath;
              console.log("NODE HIGHLIGHT: ", highlightRef.current);
              setHighlightedPath?.(highlightPath);

              // refresh the graph canvas only, no React re-render
              fgRef.current?.refresh();
            }
          }}
          linkWidth={(link) =>
            highlightRef.current.includes(link.source.id) &&
            highlightRef.current.includes(link.target.id)
              ? 4
              : 0
          }
          linkDistance={(link) => {
            // Use the timeInMonths value stored with the link to determine distance
            const timeInMonths = link.timeInMonths || 1;
            // Scale the distance: 1 month = 20 units, max 240 units (12 months * 20)
            return Math.min(timeInMonths * 20, 240);
          }}
          onNodeDragEnd={(node) => {
            // Keep "Now" fixed, but allow other nodes to be positioned
            if (node.id === "Now") {
              node.fx = 0;
              node.fy = 0;
              node.fz = 0;
            } else {
              // Optional: Fix other nodes in place after dragging
              // Remove these lines if you want nodes to move freely after drag
              // node.fx = node.x;
              // node.fy = node.y;
              // node.fz = node.z;
            }
          }}
          onEngineStop={() => {
            // Fix "Now" node at center after physics settle
            const nowNode = nodes.find((node) => node.id === "Now");
            if (nowNode) {
              nowNode.fx = 0;
              nowNode.fy = 0;
              nowNode.fz = 0;
            }
          }}
          onEngineStart={() => {
            // Set initial physics parameters for stability
            if (fgRef.current) {
              fgRef.current.d3Force("charge").strength(-50);
              fgRef.current.d3Force("center", null);
            }
          }}
        />
      )}
    </div>
  );
}
