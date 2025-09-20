"use client";
import type { User } from "next-auth";
import { useEffect, useState } from "react";
import ConfigPanel from "./configpanel";
import { nodes } from "~/server/db/schema";
import Life from "./life";

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

  const [highlightedPath, setHighlightedPathState] = useState<string[]>([]);

  useEffect(() => {
    console.log("IN LIFEWRAP", highlightedPath);
  }, [highlightedPath]);

  return (
    <div className="flex h-screen w-screen">
      <div className="flex h-full w-1/3 flex-col">
        <div className="flex w-full border-2 border-gray-500 bg-black">
          {types.map((type, idx) => (
            <button
              key={idx}
              className={`h-12 flex-1 ${screen == type.type ? "bg-gray-500" : "bg-black"} text-center text-white transition hover:bg-gray-800`}
              onClick={() => setScreen(type.type)}
            >
              {type.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto bg-neutral-900 p-3">
          {screen == "graph" ? (
            <ConfigPanel
              config={config}
              setConfig={setConfig}
              onGenerate={() => 1}
              onReset={() => 1}
            />
          ) : (
            <></>
          )}
        </div>
      </div>
      <div className="h-full w-2/3">
        <Life user={user} setHighlightedPath={setHighlightedPathState} />
      </div>
    </div>
  );
}
