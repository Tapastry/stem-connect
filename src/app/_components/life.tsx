"use client";

import type { User } from "next-auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { getHighlightPath } from "./highlight";
import { createCollapsibleGraph } from "./pruned";

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
}

interface LifeProps {
  user: User;
  setHighlightedPath?: (path: string[]) => void;
  nodes: Node[];
  links: Link[];
}

export default function Life({
  user: _user,
  setHighlightedPath,
  nodes,
  links,
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

  const graphManager = useMemo(
    () => createCollapsibleGraph(nodes, links, "Now"),
    [],
  );

  const [graphData, setGraphData] = useState(graphManager.getPrunedGraph());

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
          onNodeClick={(node: any) => {
            //Generate Data
            if (!node.childLinks || node.childLinks.length === 0) return;
            graphManager.toggleNode(node.id);
            setGraphData(graphManager.getPrunedGraph());
            fgRef.current.d3Force("charge").strength(-200);

            fgRef.current.d3Force("link").distance(60);
          }}
          nodeThreeObjectExtend={false}
          nodeThreeObject={(node: any) => {
            const group = new THREE.Group();
            const color =
              !node.childLinks || node.childLinks.length === 0
                ? "green"
                : node.collapsed
                  ? "red"
                  : "yellow";

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
          d3AlphaDecay={0.01}
          d3VelocityDecay={0.3}
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
        />
      )}
    </div>
  );
}
