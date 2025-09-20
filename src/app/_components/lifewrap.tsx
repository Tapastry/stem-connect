"use client";
import type { User } from "next-auth";
import { useEffect, useRef, useState } from "react";
import ConfigPanel from "./configpanel";
import Life from "./life";

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

const initialNodes = [
  { id: "Now", x: 0, y: 0, z: 0, color: "red", fx: 0, fy: 0, fz: 0 },
];

const initialLinks: Link[] = [];

const onNodeClick = async (
  clickedNodeId: string,
  currentPath: string[],
  config: Config,
  currentNodes: Node[],
  currentLinks: Link[],
  setNodes: (nodes: Node[]) => void,
  setLinks: (links: Link[]) => void,
) => {
  console.log("NODE CLICKED", clickedNodeId, config);

  // Find the clicked node
  const clickedNode = currentNodes.find((node) => node.id === clickedNodeId);
  if (!clickedNode) {
    console.error("Clicked node not found");
    return;
  }

  // Convert frontend nodes to backend format (only id field)
  const backendNodes = currentPath.map((node) => ({ id: node }));

  const request = {
    previous_nodes: backendNodes,
    prompt: config.prompt,
    num_nodes: config.num_nodes,
    time_in_months: config.time_in_months,
    node_type: config.type,
    positivity: config.positivity,
  };

  try {
    // Call the backend API running on port 8000
    const response = await fetch("http://localhost:8000/api/add-node", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      console.error("API request failed:", response.status);
      const errorData = await response.text();
      console.error("Error details:", errorData);
      return;
    }

    const backendNodesData = await response.json();
    console.log("New nodes generated:", backendNodesData);

    // Convert backend nodes to frontend format with positioning
    const newFrontendNodes: Node[] = backendNodesData.map(
      (backendNode: any, index: number) => {
        // Position new nodes around the clicked node
        const angle = (index / backendNodesData.length) * 2 * Math.PI;
        const distance = 4; // Increased distance to make nodes more visible

        const newNode = {
          id: backendNode.id,
          x: clickedNode.x + Math.cos(angle) * distance,
          y: clickedNode.y + Math.sin(angle) * distance,
          z: clickedNode.z + (Math.random() - 0.5) * 4, // Increased Z variation
          color: `hsl(${Math.random() * 360}, 70%, 60%)`,
        };

        console.log(
          `Created node ${newNode.id} at position:`,
          newNode.x,
          newNode.y,
          newNode.z,
        );
        return newNode;
      },
    );

    // Add new nodes to existing nodes
    const updatedNodes = [...currentNodes, ...newFrontendNodes];
    console.log(
      "Setting nodes to:",
      updatedNodes.map((n) => n.id),
    );
    setNodes(updatedNodes);

    // Generate links from the clicked node to all new nodes
    const newLinks = newFrontendNodes.map((node) => ({
      id: `${clickedNode.id}-${node.id}`,
      source: clickedNode.id,
      target: node.id,
      timeInMonths: config.time_in_months, // Store the time value with the link
    }));
    const updatedLinks = [...currentLinks, ...newLinks];
    console.log("New links created:", newLinks);
    console.log(
      "Setting links to:",
      updatedLinks.map((l) => `${l.source}->${l.target}`),
    );
    setLinks(updatedLinks);
  } catch (error) {
    console.error("Error generating nodes:", error);
  }
};

export default function LifeWrap({ user }: { user: User }) {
  const [config, setConfig] = useState({
    prompt: "",
    positivity: -1,
    time_in_months: 1,
    type: "",
    num_nodes: 1,
  });
  const types = [
    { type: "graph", name: "Graph Settings" },
    { type: "node", name: "Node View" },
  ];
  const [screen, setScreen] = useState("graph");

  const [nodes, setNodes] = useState<Node[]>(
    initialNodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      z: node.z,
      color: node.color,
      ...(node.fx !== undefined && { fx: node.fx }),
      ...(node.fy !== undefined && { fy: node.fy }),
      ...(node.fz !== undefined && { fz: node.fz }),
    })),
  );

  const [links, setLinks] = useState<Link[]>(
    initialLinks.map((link) => ({
      id: `${link.source}-${link.target}`,
      source: link.source,
      target: link.target,
    })),
  );
  const [highlightedPath, setHighlightedPathState] = useState<string[]>([]);
  const fgRef = useRef<any>(null);

  useEffect(() => {
    console.log("IN LIFEWRAP", highlightedPath);
  }, [highlightedPath]);

  return (
    <div className="flex h-screen w-screen">
      <div className="flex h-full w-1/3 flex-col border border-gray-700 bg-gray-900 shadow-lg shadow-indigo-500/10">
        {/* Tab Navigation */}
        <div className="flex w-full border-b border-gray-700 bg-gray-800 p-4">
          {types.map((type, idx) => (
            <button
              key={idx}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-all duration-150 ${
                screen === type.type
                  ? "border-b-2 border-indigo-500 bg-gray-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-gray-300"
              }`}
              onClick={() => setScreen(type.type)}
            >
              {type.name}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden p-4">
          {screen === "graph" ? (
            <div className="h-full">
              <ConfigPanel
                config={config}
                setConfig={setConfig}
                onGenerate={() => 1}
                onReset={() => 1}
              />
            </div>
          ) : (
            <div className="flex h-full w-full flex-col gap-4 p-4">
              <div className="text-center">
                <h1 className="text-xl font-bold text-white">Node View</h1>
                <p className="text-sm text-gray-400">
                  Manage individual nodes and connections
                </p>
              </div>

              <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-700 bg-gray-800/50 p-8">
                <div className="text-center">
                  <div className="mb-4 text-4xl text-gray-600">🔧</div>
                  <h3 className="mb-2 text-lg font-medium text-gray-300">
                    Coming Soon
                  </h3>
                  <p className="text-sm text-gray-500">
                    Node editing and management features will be available here
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="h-full w-2/3">
        <Life
          user={user}
          setHighlightedPath={setHighlightedPathState}
          nodes={nodes}
          links={links}
          handleNodeClick={(nodeId: string) => {
            onNodeClick(
              nodeId,
              highlightedPath,
              config,
              nodes,
              links,
              setNodes,
              setLinks,
            );
            fgRef.current.d3Force("charge").strength(-300);
            fgRef.current.d3Force("link").distance(200);
          }}
          fgRef={fgRef}
        />
      </div>
    </div>
  );
}
