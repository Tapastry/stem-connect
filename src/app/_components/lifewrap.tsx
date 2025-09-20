import { useState } from "react";
import ConfigPanel from "./configpanel";

interface LifeWrapProps {
  children: React.ReactNode;
}

export default function LifeWrap({ children }: LifeWrapProps) {
  const [config, setConfig] = useState({
    prompt: "",
    time_in_months: 1,
    type: "",
    num_nodes: 1,
  });

  return (
    <div className="flex h-screen w-screen">
      <div className="h-full w-1/3">
        <ConfigPanel onGenerate={() => 1} onReset={() => 1} />
      </div>
      <div className="h-full w-2/3">{children}</div>
    </div>
  );
}
