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
  user: User,
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

  // Convert frontend nodes to backend format with all required fields
  const backendNodes = currentPath.map((nodeId) => {
    const frontendNode = currentNodes.find((n) => n.id === nodeId);
    return {
      id: nodeId,
      name: nodeId, // Use id as name for now
      description: `Life event: ${nodeId}`,
      type: "life-event",
      image_name: "",
      time: new Date().toISOString(),
      title: nodeId,
      created_at: new Date().toISOString(),
      user_id: user.id || "anonymous",
    };
  });

  const request = {
    user_id: user.id,
    previous_nodes: backendNodes,
    clicked_node_id: clickedNodeId,
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

const onNodeDelete = async (
  nodeId: string,
  user: User,
  setNodes: (nodes: Node[]) => void,
  setLinks: (links: Link[]) => void,
) => {
  console.log("DELETING NODE", nodeId);

  try {
    const response = await fetch(
      `http://localhost:8000/api/delete-node/${user.id}/${nodeId}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      console.error("Delete request failed:", response.status);
      const errorData = await response.text();
      console.error("Error details:", errorData);
      return;
    }

    const deleteResult = await response.json();
    console.log("Delete result:", deleteResult);

    // Reload the graph data to reflect the deletions
    const graphResponse = await fetch(
      `http://localhost:8000/api/get-graph/${user.id}`,
    );

    if (graphResponse.ok) {
      const graphData = await graphResponse.json();

      // Convert database nodes to frontend format
      const frontendNodes: Node[] = graphData.nodes.map((dbNode: any) => ({
        id: dbNode.id,
        x: Math.random() * 10 - 5, // Random positioning for now
        y: Math.random() * 10 - 5,
        z: Math.random() * 10 - 5,
        color:
          dbNode.id === "You" || dbNode.id === "Now"
            ? "yellow"
            : `hsl(${Math.random() * 360}, 70%, 60%)`,
        ...((dbNode.id === "You" || dbNode.id === "Now") && {
          fx: 0,
          fy: 0,
          fz: 0,
        }),
      }));

      // Convert database links to frontend format
      const frontendLinks: Link[] = graphData.links.map((dbLink: any) => ({
        id: dbLink.id,
        source: dbLink.source,
        target: dbLink.target,
        timeInMonths: 1,
      }));

      setNodes(frontendNodes);
      setLinks(frontendLinks);
    }
  } catch (error) {
    console.error("Error deleting node:", error);
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
  const [isLoading, setIsLoading] = useState(true);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [highlightedPath, setHighlightedPathState] = useState<string[]>([]);
  const fgRef = useRef<any>(null);

  // Load graph data from database on mount
  useEffect(() => {
    const loadGraphData = async () => {
      try {
        // First, ensure the "You" node exists
        await fetch(`http://localhost:8000/api/instantiate/${user.id}`, {
          method: "POST",
        });

        // Then load all graph data
        const response = await fetch(
          `http://localhost:8000/api/get-graph/${user.id}`,
        );

        if (!response.ok) {
          console.error("Failed to load graph data:", response.status);
          // If no data exists, start with initial "You" node
          setNodes([
            {
              id: "You",
              x: 0,
              y: 0,
              z: 0,
              color: "yellow",
              fx: 0,
              fy: 0,
              fz: 0,
            },
          ]);
          setLinks([]);
          setIsLoading(false);
          return;
        }

        const graphData = await response.json();
        console.log("Loaded graph data:", graphData);

        // Convert database nodes to frontend format
        const frontendNodes: Node[] = graphData.nodes.map((dbNode: any) => ({
          id: dbNode.id,
          x: Math.random() * 10 - 5, // Random positioning for now
          y: Math.random() * 10 - 5,
          z: Math.random() * 10 - 5,
          color:
            dbNode.id === "Now"
              ? "yellow"
              : `hsl(${Math.random() * 360}, 70%, 60%)`,
          ...(dbNode.id === "Now" && { fx: 0, fy: 0, fz: 0 }), // Fix "Now" at center
        }));

        // Convert database links to frontend format
        const frontendLinks: Link[] = graphData.links.map((dbLink: any) => ({
          id: dbLink.id,
          source: dbLink.source,
          target: dbLink.target,
          timeInMonths: 1, // Default for now, could be stored in DB later
        }));

        setNodes(frontendNodes);
        setLinks(frontendLinks);
        setIsLoading(false);
      } catch (error) {
        console.error("Error loading graph data:", error);
        // Fallback to initial state
        setNodes(
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
        setLinks([]);
        setIsLoading(false);
      }
    };

    loadGraphData();
  }, [user.id]);

  useEffect(() => {
    console.log("IN LIFEWRAP", highlightedPath);
  }, [highlightedPath]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="mb-4 text-4xl text-indigo-500">🔄</div>
          <h2 className="mb-2 text-xl font-bold text-white">
            Loading Your Life Graph
          </h2>
          <p className="text-gray-400">
            Fetching your nodes and connections...
          </p>
        </div>
      </div>
    );
  }

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
              user,
              config,
              nodes,
              links,
              setNodes,
              setLinks,
            );
            fgRef.current.d3Force("charge").strength(-300);
            fgRef.current.d3Force("link").distance(200);
          }}
          handleNodeDelete={(nodeId: string) => {
            onNodeDelete(nodeId, user, setNodes, setLinks);
          }}
          fgRef={fgRef}
        />
      </div>
    </div>
  );
}
