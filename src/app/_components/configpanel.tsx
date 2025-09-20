import React from "react";
import { nodeTypes } from "../../consts/consts";

// Type definitions
interface Config {
  prompt: string;
  positivity: number;
  time_in_months: number;
  type: string;
  num_nodes: number;
}

interface ConfigPanelProps {
  config: Config;
  setConfig: (config: Config | ((prev: Config) => Config)) => void;
  onGenerate?: (config: Config) => void;
  onReset?: () => void;
}

// A custom SVG component for the search icon to keep the JSX clean.
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="h-5 w-5"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fillRule="evenodd"
      d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
      clipRule="evenodd"
    />
  </svg>
);

// The main control panel component.
const ConfigPanel: React.FC<ConfigPanelProps> = ({
  config,
  setConfig,
  onGenerate,
  onReset,
}) => {
  // Get currently selected node types as an array
  const getSelectedNodeTypes = (): string[] => {
    return config.type
      ? config.type
          .split(",")
          .map((id: string) => id.trim())
          .filter(Boolean)
      : [];
  };

  // Handler to toggle a node type's active state
  const handleNodeTypeToggle = (nodeTypeId: string) => {
    const selectedTypes = getSelectedNodeTypes();
    const isSelected = selectedTypes.includes(nodeTypeId);

    let newSelectedTypes: string[];
    if (isSelected) {
      // Remove the node type
      newSelectedTypes = selectedTypes.filter(
        (id: string) => id !== nodeTypeId,
      );
    } else {
      // Add the node type
      newSelectedTypes = [...selectedTypes, nodeTypeId];
    }

    // Update config with comma-separated string
    setConfig((prev: Config) => ({
      ...prev,
      type: newSelectedTypes.join(","),
    }));
  };

  const handleGenerateClick = () => {
    if (onGenerate) {
      onGenerate(config);
    }
    console.log("Generating life graph with:", config);
  };

  const handleResetClick = () => {
    setConfig({
      prompt: "",
      positivity: -1,
      time_in_months: 1,
      type: "",
      num_nodes: 1,
    });
    if (onReset) {
      onReset();
    }
    console.log("Resetting controls");
  };

  return (
    <>
      <style>
        {`
          .custom-range::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 18px;
              height: 18px;
              background: #6366f1; /* bg-indigo-500 */
              cursor: pointer;
              border-radius: 50%;
              border: 2px solid #e5e7eb; /* bg-gray-200 */
          }
          .custom-range::-moz-range-thumb {
              width: 18px;
              height: 18px;
              background: #6366f1;
              cursor: pointer;
              border-radius: 50%;
              border: 2px solid #e5e7eb;
          }
                `}
      </style>

      {/* Control Panel Component */}
      <div className="flex h-full w-full flex-col gap-4 border border-gray-700 bg-gray-900 p-4 font-sans shadow-lg shadow-indigo-500/10">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-white">Life Graph Console</h1>
          <p className="text-sm text-gray-400">
            Configure your life event visualization
          </p>
        </div>

        {/* Main Prompt Input */}
        <div className="flex flex-col gap-2 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
          <label htmlFor="prompt" className="text-sm font-medium text-gray-300">
            Life Event Prompt
          </label>
          <div className="flex items-center gap-2">
            <input
              id="prompt"
              type="text"
              placeholder="e.g., 'My career transition into tech'"
              value={config.prompt}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setConfig((prev: Config) => ({
                  ...prev,
                  prompt: e.target.value,
                }))
              }
              className="w-full rounded-md border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white transition duration-150 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            />
            <button className="shrink-0 rounded-md bg-indigo-600 p-2 text-white transition-colors duration-150 hover:bg-indigo-500">
              <SearchIcon />
            </button>
          </div>
        </div>

        {/* Parameter Controls */}
        <div className="flex flex-col gap-4 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
          <h2 className="text-sm font-medium text-gray-300">
            Adjust Parameters
          </h2>

          {/* Time Range Dial */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="time_in_months" className="text-xs text-gray-400">
                Time Range (months)
              </label>
              <span className="rounded-full bg-indigo-900/50 px-2 py-1 text-xs font-semibold text-indigo-300">
                {config.time_in_months}
              </span>
            </div>
            <input
              id="time_in_months"
              type="range"
              min="1"
              max="120"
              value={config.time_in_months}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setConfig((prev: Config) => ({
                  ...prev,
                  time_in_months: parseInt(e.target.value),
                }))
              }
              className="custom-range h-[6px] w-full cursor-pointer appearance-none rounded-lg bg-gray-600 transition-opacity outline-none hover:opacity-100"
            />
          </div>

          {/* Number of Nodes Dial */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="num_nodes" className="text-xs text-gray-400">
                Number of Nodes
              </label>
              <span className="rounded-full bg-indigo-900/50 px-2 py-1 text-xs font-semibold text-indigo-300">
                {config.num_nodes}
              </span>
            </div>
            <input
              id="num_nodes"
              type="range"
              min="1"
              max="5"
              value={config.num_nodes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setConfig((prev: Config) => ({
                  ...prev,
                  num_nodes: parseInt(e.target.value),
                }))
              }
              className="custom-range h-[6px] w-full cursor-pointer appearance-none rounded-lg bg-gray-600 transition-opacity outline-none hover:opacity-100"
            />
          </div>

          {/* Positivity Control */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="positivity" className="text-xs text-gray-400">
                Event Positivity {/* DEBUG: positivity = {config.positivity} */}
              </label>
              <button
                onClick={() =>
                  setConfig((prev: Config) => ({
                    ...prev,
                    positivity: prev.positivity === -1 ? 0 : -1,
                  }))
                }
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all duration-200 ${
                  config.positivity === -1
                    ? "bg-gray-600 text-gray-300 hover:bg-gray-500"
                    : "bg-indigo-600 text-white hover:bg-indigo-500"
                }`}
                title={
                  config.positivity === -1
                    ? "Click to enable positivity control"
                    : "Click to disable positivity control"
                }
              >
                {config.positivity === -1 ? "Random" : `${config.positivity}%`}
              </button>
            </div>
            {config.positivity !== -1 && (
              <div className="mb-4">
                <input
                  id="positivity"
                  type="range"
                  min="0"
                  max="100"
                  value={config.positivity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setConfig((prev: Config) => ({
                      ...prev,
                      positivity: parseInt(e.target.value),
                    }))
                  }
                  className="custom-range h-[6px] w-full cursor-pointer appearance-none rounded-lg bg-gray-600 transition-opacity outline-none hover:opacity-100"
                />
              </div>
            )}
          </div>
        </div>

        {/* Node Type Toggles */}
        <div className="flex flex-1 flex-col gap-2 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
          <h2 className="text-sm font-medium text-gray-300">
            Life Event Types
          </h2>
          <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto">
            {nodeTypes.map((nodeType) => {
              const isSelected = getSelectedNodeTypes().includes(nodeType.id);
              return (
                <button
                  key={nodeType.id}
                  onClick={() => handleNodeTypeToggle(nodeType.id)}
                  className={`rounded-md px-2 py-2 text-xs transition-colors duration-150 ${
                    isSelected
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                  }`}
                  title={nodeType.description}
                >
                  {nodeType.label}
                </button>
              );
            })}
          </div>
          {getSelectedNodeTypes().length > 0 && (
            <div className="mt-2 text-xs text-gray-400">
              Selected: {getSelectedNodeTypes().length} type
              {getSelectedNodeTypes().length !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <button
            onClick={handleGenerateClick}
            className="w-full rounded-lg bg-green-600 py-2.5 font-semibold text-white shadow-md transition-colors duration-150 hover:bg-green-500"
          >
            Generate Life Graph
          </button>
          <button
            onClick={handleResetClick}
            className="w-full rounded-lg bg-gray-700 py-2 font-medium text-gray-300 transition-colors duration-150 hover:bg-gray-600 hover:text-white"
          >
            Reset
          </button>
        </div>
      </div>
    </>
  );
};

export default ConfigPanel;
