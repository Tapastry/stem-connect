"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

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
  const { data: session, status } = useSession();
  const router = useRouter();

  // Generate procedural nodes and links
  const generateGraphData = (count: number): { nodes: any[]; links: any[] } => {
    const nodes: any[] = [];
    const links: any[] = [];
    
    // Generate fixed nodes with colors and positions scattered across visible screen
    for (let i = 0; i < count; i++) {
      // Tight distribution within visible screen boundaries
      const x = (Math.random() - 0.5) * 400; // Spread across 400 units horizontally (visible area)
      const y = (Math.random() - 0.5) * 300; // Spread across 300 units vertically (visible area)
      const z = (Math.random() - 0.5) * 200; // Spread across 200 units in depth (visible area)
      
      nodes.push({
        id: `node-${i}`,
        group: Math.floor(Math.random() * 10),
        color: nodeColors[Math.floor(Math.random() * nodeColors.length)],
        val: Math.random() * 10 + 1, // Random size between 1-11
        // Allow subtle movement by not fixing positions
        x: x,
        y: y,
        z: z,
      });
    }

    // Minimal connections to prevent clustering - only connect a few nodes
    if (nodes.length >= 2) {
      // Only connect 2-3 random pairs to create a loose network
      const numConnections = Math.min(3, Math.floor(nodes.length / 3));
      for (let i = 0; i < numConnections; i++) {
        const sourceIndex = Math.floor(Math.random() * nodes.length);
        const targetIndex = Math.floor(Math.random() * nodes.length);
        if (sourceIndex !== targetIndex) {
          links.push({
            source: nodes[sourceIndex]?.id ?? "",
            target: nodes[targetIndex]?.id ?? "",
            value: 1,
          });
        }
      }
    }

    return { nodes, links };
  };

  const [graphData, setGraphData] = useState(generateGraphData(8)); // Start with 8 fixed nodes
  const MAX_NODES = 40; // Cap at 40 nodes

  // Handle Google sign-in or redirect to life page
  const handleSignIn = () => {
    console.log("Sign in button clicked");
    console.log("Session status:", status);
    console.log("Session data:", session);
    
    // If user is already signed in, redirect to /life
    if (session) {
      console.log("User already signed in, redirecting to /life");
      router.push("/life");
      return;
    }
    
    // If user is not signed in, start Google OAuth flow
    console.log("Starting Google OAuth flow");
    try {
      void signIn("google", { callbackUrl: "/life" });
    } catch (error) {
      console.error("Sign in error:", error);
    }
  };

  // Function to add a new connecting node (with 40 node limit)
  const addConnectingNode = (currentData: { nodes: any[]; links: any[] }): { nodes: any[]; links: any[] } => {
    // If we're at the limit, remove the oldest connecting node before adding a new one
    if (currentData.nodes.length >= MAX_NODES) {
      const connectingNodes = currentData.nodes.filter((node: any) => node.id.startsWith('connecting-node'));
      if (connectingNodes.length > 0) {
        // Remove the oldest connecting node
        const oldestNode = connectingNodes.sort((a: any, b: any) => {
          const aId = typeof a.id === 'string' ? a.id : '';
          const bId = typeof b.id === 'string' ? b.id : '';
          const aTime = parseInt((aId.split('-')[2] ?? '0') as string, 10);
          const bTime = parseInt((bId.split('-')[2] ?? '0') as string, 10);
          return aTime - bTime;
        })[0];
        
        const newNodes = currentData.nodes.filter((node: any) => node.id !== oldestNode.id);
        const newLinks = currentData.links.filter((link: any) => 
          link.source !== oldestNode.id && link.target !== oldestNode.id
        );
        
        return { nodes: newNodes, links: newLinks };
      }
      return currentData;
    }
    
    const timestamp = Date.now();
    const connectingNodeId = `connecting-node-${timestamp}`;
    
    // Simply add to existing data - no filtering, no cleanup
    const newNodes = [...currentData.nodes];
    const newLinks = [...currentData.links];
    
    // Add new connecting node within visible screen boundaries
    const x = (Math.random() - 0.5) * 400; // Spread across 400 units horizontally (visible area)
    const y = (Math.random() - 0.5) * 300; // Spread across 300 units vertically (visible area)
    const z = (Math.random() - 0.5) * 200; // Spread across 200 units in depth (visible area)
    
    const connectingNode = {
      id: connectingNodeId,
      group: Math.floor(Math.random() * 10),
      color: nodeColors[Math.floor(Math.random() * nodeColors.length)], // Random color from palette
      val: Math.random() * 8 + 2, // Random size between 2-10
      x, y, z,
      // Allow subtle movement by not fixing position
    };

    newNodes.push(connectingNode);

    // Connect to 0-1 random fixed nodes (the original 8) - fewer connections to prevent clustering
    const fixedNodes = currentData.nodes.filter((node: any) => !node.id.startsWith('connecting-node'));
    const numConnections = Math.random() < 0.3 ? 1 : 0; // Only 30% chance of connection
    
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      setSpriteText(() => module.default);
    }).catch((error: unknown) => {
      // Handle import error silently
      console.warn('Failed to load three-spritetext:', error);
      setSpriteText(null);
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

  // Configure forces for visible screen distribution
  useEffect(() => {
    if (graphRef.current) {
      // Shorter link distance to prevent clustering
      graphRef.current.d3Force('link').distance(40);
      // Gentle charge force for subtle movement without off-screen drift
      graphRef.current.d3Force('charge').strength(-15);
      // Very weak center force to keep nodes roughly centered
      graphRef.current.d3Force('center').strength(0.05);
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

  // Set initial camera position to show visible screen area
  useEffect(() => {
    if (graphRef.current) {
      // Set camera to show the tight visible screen boundaries
      graphRef.current.cameraPosition({ x: 0, y: 0, z: 600 });
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
          
          <button 
           onClick={handleSignIn}
           className="group relative mt-12 px-16 py-5 bg-gradient-to-r from-white/10 to-white/5 backdrop-blur-sm border border-white/20 rounded-full font-light text-xl transition-all duration-300 hover:from-white/20 hover:to-white/10 hover:scale-105 hover:shadow-2xl hover:shadow-white/10 font-inter"
         >
            <span className="relative z-10">
              {status === "loading" ? "loading..." : session ? "continue simulating" : "start simulating"}
            </span>
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
          nodeRelSize={8}
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
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.6}
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
        
        <button 
          onClick={handleSignIn}
          className="group relative mt-12 px-16 py-5 bg-gradient-to-r from-white/10 to-white/5 backdrop-blur-sm border border-white/20 rounded-full font-light text-xl transition-all duration-300 hover:from-white/20 hover:to-white/10 hover:scale-105 hover:shadow-2xl hover:shadow-white/10 font-inter"
        >
          <span className="relative z-10">
            {status === "loading" ? "loading..." : session ? "continue simulating" : "start simulating"}
          </span>
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        </button>
      </div>
    </main>
  );
}
