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
            
            // Store current positions of existing nodes to minimize movement
            const currentPositions = new Map();
            graphData.nodes.forEach((n: any) => {
              currentPositions.set(n.id, { x: n.x, y: n.y, z: n.z });
            });
            
            graphManager.toggleNode(node.id);
            setGraphData(graphManager.getPrunedGraph());
            
            // Restore positions of existing nodes and position new nodes outward
            setTimeout(() => {
              const newGraphData = graphManager.getPrunedGraph();
              const parentPosition = { x: node.x, y: node.y, z: node.z };
              
              newGraphData.nodes.forEach((n: any) => {
                if (currentPositions.has(n.id)) {
                  // Restore existing node positions
                  const pos = currentPositions.get(n.id);
                  n.x = pos.x;
                  n.y = pos.y;
                  n.z = pos.z;
                  n.fx = pos.x;
                  n.fy = pos.y;
                  n.fz = pos.z;
                } else {
                  // Position new nodes outward from their parent with better distribution
                  const distance = 100; // Distance from parent
                  
                  // Get existing child nodes to avoid overlapping positions
                  const existingChildren = newGraphData.nodes.filter((child: any) => 
                    child.id !== n.id && 
                    !currentPositions.has(child.id) && 
                    child.id !== node.id
                  );
                  
                  // Calculate a good angle to avoid existing children
                  let angle = Math.random() * Math.PI * 2;
                  if (existingChildren.length > 0) {
                    // Try to find a gap between existing children
                    const childAngles = existingChildren.map((child: any) => {
                      const dx = child.x - parentPosition.x;
                      const dz = child.z - parentPosition.z;
                      return Math.atan2(dz, dx);
                    });
                    
                    // Find the largest gap and place the node there
                    childAngles.sort((a, b) => a - b);
                    let maxGap = 0;
                    let bestAngle = angle;
                    
                    for (let i = 0; i < childAngles.length; i++) {
                      const nextAngle = childAngles[(i + 1) % childAngles.length];
                      const gap = nextAngle - childAngles[i];
                      const normalizedGap = gap < 0 ? gap + Math.PI * 2 : gap;
                      
                      if (normalizedGap > maxGap) {
                        maxGap = normalizedGap;
                        bestAngle = childAngles[i] + normalizedGap / 2;
                      }
                    }
                    angle = bestAngle;
                  }
                  
                  const elevation = (Math.random() - 0.5) * Math.PI * 0.5; // Reduced elevation range
                  
                  n.x = parentPosition.x + distance * Math.cos(angle) * Math.cos(elevation);
                  n.y = parentPosition.y + distance * Math.sin(elevation);
                  n.z = parentPosition.z + distance * Math.sin(angle) * Math.cos(elevation);
                  
                  // Don't fix positions - let physics handle it naturally
                }
              });
              setGraphData({ ...newGraphData });
            }, 0);
            
            // Use gentler physics parameters
            fgRef.current.d3Force("charge").strength(-50);
            fgRef.current.d3Force("link").distance(80);
            
            // Disable center force to prevent nodes from being pulled to center
            fgRef.current.d3Force("center", null);
            
            // Reduce velocity decay to prevent excessive movement
            fgRef.current.d3VelocityDecay(0.8);
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
