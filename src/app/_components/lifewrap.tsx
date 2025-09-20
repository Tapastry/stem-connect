"use client";
import type { User } from "next-auth";
import { useEffect, useState } from "react";
import ConfigPanel from "./configpanel";
import Life from "./life";

export default function LifeWrap({ user }: { user: User }) {
  const [config, setConfig] = useState({
    prompt: "",
    positivity: -1,
    time_in_months: 1,
    type: "",
    num_nodes: 1,
  });

  const [highlightedPath, setHighlightedPathState] = useState<string[]>([]);

  useEffect(() => {
    console.log("IN LIFEWRAP", highlightedPath);
  }, [highlightedPath]);

  return (
    <div className="flex h-screen w-screen">
      <div className="h-full w-1/3">
        <ConfigPanel
          config={config}
          setConfig={setConfig}
          onGenerate={() => 1}
          onReset={() => 1}
        />
      </div>
      <div className="h-full w-2/3">
        <Life user={user} setHighlightedPath={setHighlightedPathState} />
      </div>
    </div>
  );
}
