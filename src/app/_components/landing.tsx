"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// Dynamically import the 3D components to avoid SSR issues
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-black" />
});

// Color palette for nodes
const nodeColors = [
  "#ff6b6b", // red
  "#4ecdc4", // teal
  "#45b7d1", // blue
  "#96ceb4", // green
  "#feca57", // yellow
  "#ff9ff3", // pink
  "#54a0ff", // light blue
  "#5f27cd", // purple
  "#00d2d3", // cyan
  "#ff9f43", // orange
];

export default function Landing() {
  const [isMounted, setIsMounted] = useState(false);
  const [SpriteText, setSpriteText] = useState<any>(null);
  const [isAddingNode, setIsAddingNode] = useState(false);
  const graphRef = useRef<any>(null);

  // Generate procedural nodes and links
  const generateGraphData = (count: number) => {
    const nodes: any[] = [];
    const links: any[] = [];
    
    // Generate fixed nodes with colors and positions
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI;
      const radius = 200;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const z = (Math.random() - 0.5) * 100; // Random z position
      
      nodes.push({
        id: `node-${i}`,
        group: Math.floor(Math.random() * 10),
        color: nodeColors[Math.floor(Math.random() * nodeColors.length)],
        val: Math.random() * 10 + 1, // Random size between 1-11
        // Fix nodes in place
        fx: x,
        fy: y,
        fz: z,
      });
    }

    // Ensure each node connects to 1-3 other nodes
    if (nodes.length >= 2) {
      // Connect the first two nodes to establish the initial connection
      if (nodes.length === 2) {
        links.push({
          source: nodes[0]?.id ?? "",
          target: nodes[1]?.id ?? "",
          value: 1,
        });
      } else {
        // For each node, ensure it has 1-3 connections
        for (let i = 0; i < nodes.length; i++) {
          const currentConnections = links.filter(link => 
            link.source === nodes[i]?.id || link.target === nodes[i]?.id
          ).length;
          
          // If this node has less than 1 connection, add one
          if (currentConnections < 1) {
            const availableNodes = nodes.filter((_, j) => j !== i);
            const targetNode = availableNodes[Math.floor(Math.random() * availableNodes.length)];
            links.push({
              source: nodes[i]?.id ?? "",
              target: targetNode?.id ?? "",
              value: 1,
            });
          }
          
          // Add 0-2 additional random connections (max 3 total)
          const additionalConnections = Math.floor(Math.random() * 3); // 0, 1, or 2
          for (let j = 0; j < additionalConnections; j++) {
            const currentConnections = links.filter(link => 
              link.source === nodes[i]?.id || link.target === nodes[i]?.id
            ).length;
            
            if (currentConnections < 3) {
              const availableNodes = nodes.filter((_, k) => 
                k !== i && 
                !links.some(link => 
                  (link.source === nodes[i]?.id && link.target === nodes[k]?.id) ||
                  (link.target === nodes[i]?.id && link.source === nodes[k]?.id)
                )
              );
              
              if (availableNodes.length > 0) {
                const targetNode = availableNodes[Math.floor(Math.random() * availableNodes.length)];
                links.push({
                  source: nodes[i]?.id ?? "",
                  target: targetNode?.id ?? "",
                  value: 1,
                });
              }
            }
          }
        }
      }
    }

    return { nodes, links };
  };

  const [graphData, setGraphData] = useState(generateGraphData(8)); // Start with 8 fixed nodes

  // Function to add a new connecting node (no cleanup, no limits)
  const addConnectingNode = (currentData: any) => {
    const timestamp = Date.now();
    const connectingNodeId = `connecting-node-${timestamp}`;
    
    // Simply add to existing data - no filtering, no cleanup
    const newNodes = [...currentData.nodes];
    const newLinks = [...currentData.links];
    
    // Add new connecting node
    const angle = Math.random() * 2 * Math.PI;
    const radius = 150 + Math.random() * 100;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = (Math.random() - 0.5) * 200;
    
    const connectingNode = {
      id: connectingNodeId,
      group: 0,
      color: '#ffffff', // White connecting node
      val: 3, // Smaller size
      x, y, z,
      fx: x, fy: y, fz: z, // Fixed position
    };

    newNodes.push(connectingNode);

    // Connect to 1-2 random fixed nodes (the original 8)
    const fixedNodes = currentData.nodes.filter((node: any) => !node.id.startsWith('connecting-node'));
    const numConnections = Math.floor(Math.random() * 2) + 1; // 1 or 2 connections
    
    for (let i = 0; i < numConnections && fixedNodes.length > 0; i++) {
      const targetNode = fixedNodes[Math.floor(Math.random() * fixedNodes.length)];
      newLinks.push({
        source: connectingNodeId,
        target: targetNode.id,
        value: 1,
      });
    }

    return { nodes: newNodes, links: newLinks };
  };

  useEffect(() => {
    setIsMounted(true);
    
    // Dynamically import SpriteText
    import("three-spritetext").then((module: { default: any }) => {
      setSpriteText(() => module.default);
    }).catch(() => {
      // Handle import error silently
    });
    
    // Add new connecting nodes that appear and disappear
    const nodeInterval = setInterval(() => {
      setIsAddingNode(true);
      setGraphData(currentData => addConnectingNode(currentData));
      
      // Resume simulation after a brief pause
      setTimeout(() => {
        setIsAddingNode(false);
      }, 200);
    }, 800); // Add new connecting node every 0.8 seconds

    return () => clearInterval(nodeInterval);
  }, []);

  // Configure forces for better node spacing
  useEffect(() => {
    if (graphRef.current) {
      // Adjust link force for fixed nodes
      graphRef.current.d3Force('link').distance(100);
      // Reduce charge force since most nodes are fixed
      graphRef.current.d3Force('charge').strength(-50);
    }
  }, [graphData]);

  // Pause/resume simulation when adding nodes
  useEffect(() => {
    if (graphRef.current) {
      if (isAddingNode) {
        // Pause the simulation
        graphRef.current.pauseAnimation();
      } else {
        // Resume the simulation
        graphRef.current.resumeAnimation();
      }
    }
  }, [isAddingNode]);

  // Set initial camera position and keep it zoomed out
  useEffect(() => {
    if (graphRef.current) {
      // Set camera to stay zoomed out
      graphRef.current.cameraPosition({ x: 0, y: 0, z: 800 });
    }
  }, [graphData]);


  if (!isMounted || !SpriteText) {
    return (
      <main className="relative flex min-h-screen flex-col items-center justify-center bg-black text-white overflow-hidden">
        <div className="relative z-10 flex flex-col items-center justify-center gap-12 px-4 py-16 max-w-4xl mx-auto">
          <div className="text-center space-y-6">
            <h1 className="text-7xl font-light tracking-wider sm:text-[8rem] text-center bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent font-space-grotesk">
              TAPESTRY
            </h1>
            
            <h2 className="text-3xl font-light text-center text-gray-400 tracking-wide font-inter">
              simulate your life
            </h2>
          </div>
          
          <button className="group relative mt-12 px-16 py-5 bg-gradient-to-r from-white/10 to-white/5 backdrop-blur-sm border border-white/20 rounded-full font-light text-xl transition-all duration-300 hover:from-white/20 hover:to-white/10 hover:scale-105 hover:shadow-2xl hover:shadow-white/10 font-inter">
            <span className="relative z-10">start simulating</span>
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-black text-white overflow-hidden">
      {/* 3D Force Graph Background */}
      <div className="absolute inset-0 w-full h-full opacity-40 blur-sm">
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData}
          nodeColor="color"
          nodeVal="val"
          nodeRelSize={6}
          linkColor={(link: any) => {
            // Find the source node to get its color
            const sourceNode = graphData.nodes.find((node: any) => node.id === link.source);
            if (sourceNode?.color) {
              // Use the source node's color with more opacity for better visibility
              return sourceNode.color + "CC"; // Add CC for 80% opacity in hex
            }
            return "rgba(255, 255, 255, 0.8)"; // Fallback to white with higher opacity
          }}
          linkWidth={2}
          linkOpacity={0.8}
          backgroundColor="rgba(0,0,0,0)"
          enableNodeDrag={false}
          enableNavigationControls={false}
          enablePointerInteraction={false}
          d3AlphaDecay={0.005}
          d3VelocityDecay={0.5}
        />
      </div>
      
      {/* Main Content Overlay */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-12 px-4 py-16 max-w-4xl mx-auto">
        <div className="text-center space-y-6">
          <h1 className="text-7xl font-light tracking-wider sm:text-[8rem] text-center bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent font-space-grotesk">
            TAPESTRY
          </h1>
          
          <h2 className="text-3xl font-light text-center text-gray-400 tracking-wide font-inter">
            simulate your life
          </h2>
        </div>
        
        <button className="group relative mt-12 px-16 py-5 bg-gradient-to-r from-white/10 to-white/5 backdrop-blur-sm border border-white/20 rounded-full font-light text-xl transition-all duration-300 hover:from-white/20 hover:to-white/10 hover:scale-105 hover:shadow-2xl hover:shadow-white/10 font-inter">
          <span className="relative z-10">start simulating</span>
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        </button>
      </div>
    </main>
  );
}
