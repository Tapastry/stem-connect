import { useState } from "react";

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
const KnowledgeGraphControls = ({ onGenerate, onReset }) => {
  // State for all the interactive elements
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState(3);
  const [strength, setStrength] = useState(75);
  const [filters, setFilters] = useState({
    people: true,
    organizations: true,
    concepts: false,
    publications: true,
  });

  // Handler to toggle a filter's active state
  const handleFilterToggle = (filterKey) => {
    setFilters((prevFilters) => ({
      ...prevFilters,
      [filterKey]: !prevFilters[filterKey],
    }));
  };

  const handleGenerateClick = () => {
    if (onGenerate) {
      onGenerate({ query, depth, strength, filters });
    }
    console.log("Generating graph with:", { query, depth, strength, filters });
  };

  const handleResetClick = () => {
    setQuery("");
    setDepth(3);
    setStrength(75);
    setFilters({
      people: true,
      organizations: true,
      concepts: false,
      publications: true,
    });
    if (onReset) {
      onReset();
    }
    console.log("Resetting controls");
  };

  return (
    <>
      {/* Styling pseudo-elements like ::-webkit-slider-thumb isn't possible with inline styles or Tailwind directly.
              This style block is a common way to apply them within a component file.
            */}
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
          <h1 className="text-xl font-bold text-white">Graph Console</h1>
          <p className="text-sm text-gray-400">
            Define parameters for graph generation
          </p>
        </div>

        {/* Main Query Input */}
        <div className="flex flex-col gap-2 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
          <label htmlFor="query" className="text-sm font-medium text-gray-300">
            Central Node Query
          </label>
          <div className="flex items-center gap-2">
            <input
              id="query"
              type="text"
              placeholder="e.g., 'Artificial Intelligence'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white transition duration-150 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            />
            <button className="shrink-0 rounded-md bg-indigo-600 p-2 text-white transition-colors duration-150 hover:bg-indigo-500">
              <SearchIcon />
            </button>
          </div>
        </div>

        {/* Parameter Dials */}
        <div className="flex flex-col gap-4 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
          <h2 className="text-sm font-medium text-gray-300">
            Adjust Parameters
          </h2>
          {/* Depth Dial */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="depth" className="text-xs text-gray-400">
                Depth Level
              </label>
              <span className="rounded-full bg-indigo-900/50 px-2 py-1 text-xs font-semibold text-indigo-300">
                {depth}
              </span>
            </div>
            <input
              id="depth"
              type="range"
              min="1"
              max="10"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              className="custom-range h-[6px] w-full cursor-pointer appearance-none rounded-lg bg-gray-600 transition-opacity outline-none hover:opacity-100"
            />
          </div>
          {/* Connection Strength Dial */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="strength" className="text-xs text-gray-400">
                Connection Strength
              </label>
              <span className="rounded-full bg-indigo-900/50 px-2 py-1 text-xs font-semibold text-indigo-300">
                {strength}%
              </span>
            </div>
            <input
              id="strength"
              type="range"
              min="0"
              max="100"
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
              className="custom-range h-[6px] w-full cursor-pointer appearance-none rounded-lg bg-gray-600 transition-opacity outline-none hover:opacity-100"
            />
          </div>
        </div>

        {/* Filter Toggles */}
        <div className="flex flex-col gap-2 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
          <h2 className="text-sm font-medium text-gray-300">
            Filter by Category
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(filters).map((filterKey) => (
              <button
                key={filterKey}
                onClick={() => handleFilterToggle(filterKey)}
                className={`rounded-md py-2 text-xs capitalize transition-colors duration-150 ${
                  filters[filterKey]
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-600 text-gray-300"
                }`}
              >
                {filterKey}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <button
            onClick={handleGenerateClick}
            className="w-full rounded-lg bg-green-600 py-2.5 font-semibold text-white shadow-md transition-colors duration-150 hover:bg-green-500"
          >
            Generate Graph
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

export default KnowledgeGraphControls;
