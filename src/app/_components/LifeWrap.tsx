import KnowledgeGraphControls from "./KnowledgeGraphControls";

interface LifeWrapProps {
  children: React.ReactNode;
}

export default function LifeWrap({ children }: LifeWrapProps) {
  return (
    <div className="flex h-screen w-screen">
      <div className="h-full w-1/3">
        <KnowledgeGraphControls onGenerate={() => 1} onReset={() => 1} />
      </div>
      <div className="h-full w-2/3">{children}</div>
    </div>
  );
}
