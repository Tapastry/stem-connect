"use client";
import type { User } from "next-auth";
import { useEffect, useState } from "react";
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
}

const initialNodes = [
  { id: "Now", x: 0, y: 0, z: 0, color: "red", fx: 0, fy: 0, fz: 0 },
  { id: "College Graduate", x: 1, y: 1, z: 1, color: "blue" },
  { id: "Bootcamp Grad", x: 1, y: -0.5, z: 0.5, color: "lightblue" },
  { id: "Gap Year Traveler", x: 0.5, y: 1.5, z: 0.5, color: "gold" },
  { id: "Grad School (MS CS)", x: 1.5, y: 1.2, z: 1.1, color: "navy" },
  { id: "Relocated to SF", x: 2, y: 2.5, z: 1.5, color: "teal" },
  { id: "Relocated to NYC", x: 2, y: 1.2, z: 2.5, color: "slateblue" },

  { id: "Software Engineer", x: 2, y: 2, z: 2, color: "green" },
  { id: "Startup Engineer #3", x: 2.5, y: 2.2, z: 1.5, color: "seagreen" },
  { id: "Product Manager", x: 2.2, y: 1.2, z: 2, color: "dodgerblue" },
  { id: "Data Scientist", x: 2.2, y: 2.8, z: 2.2, color: "mediumseagreen" },
  { id: "Security Engineer", x: 2.1, y: 1.8, z: 2.9, color: "darkred" },
  { id: "Game Developer", x: 2.4, y: 0.6, z: 1.8, color: "mediumorchid" },

  { id: "Senior Software Engineer", x: 3, y: 3, z: 3, color: "yellow" },
  { id: "Tech Lead", x: 3.2, y: 2.6, z: 2.8, color: "khaki" },
  { id: "Staff Engineer", x: 3.4, y: 3.3, z: 3.1, color: "lightyellow" },
  {
    id: "Open Source Maintainer",
    x: 3.1,
    y: 2.1,
    z: 3.5,
    color: "limegreen",
  },
  { id: "Engineering Manager", x: 3.3, y: 2.3, z: 2.2, color: "orange" },

  { id: "Architect", x: 4, y: 4, z: 4, color: "purple" },
  { id: "Principal Engineer", x: 4.4, y: 4.6, z: 3.7, color: "indigo" },
  {
    id: "Platform Architect",
    x: 4.2,
    y: 3.6,
    z: 4.2,
    color: "rebeccapurple",
  },

  { id: "CTO", x: 5, y: 5, z: 5, color: "orange" },
  { id: "CISO", x: 5.1, y: 4.1, z: 5.4, color: "crimson" },
  { id: "Director of Engineering", x: 5.2, y: 5.8, z: 4.8, color: "coral" },
  { id: "Angel Investor", x: 5.6, y: 5.4, z: 5.6, color: "salmon" },

  { id: "CEO", x: 6, y: 6, z: 6, color: "pink" },
  { id: "Founder", x: 7, y: 7, z: 7, color: "brown" },
  { id: "Serial Founder", x: 7.4, y: 7.6, z: 7.4, color: "sienna" },
  { id: "Startup IPO", x: 7.8, y: 8.4, z: 7.6, color: "lightgreen" },
  { id: "Acquired", x: 7.6, y: 7.2, z: 6.6, color: "lightcoral" },
  { id: "Failed Startup", x: 6.6, y: 6.4, z: 6.8, color: "gray" },
  { id: "Entrepreneur in Residence", x: 6.8, y: 7.1, z: 6.2, color: "tan" },
  { id: "VC Partner", x: 6.9, y: 8.1, z: 6.9, color: "plum" },

  { id: "Nonprofit Founder", x: 6.2, y: 5.5, z: 5.2, color: "darkcyan" },
  {
    id: "Government Tech Fellow",
    x: 4.9,
    y: 4.2,
    z: 4.9,
    color: "steelblue",
  },

  { id: "Freelancer", x: 5.5, y: 4.8, z: 4.6, color: "lightsteelblue" },
  { id: "Back to SWE", x: 4.8, y: 4.5, z: 4.8, color: "forestgreen" },

  { id: "PhD", x: 3.4, y: 4.0, z: 3.8, color: "darkviolet" },
  { id: "AI Researcher", x: 3.8, y: 4.5, z: 4.1, color: "mediumvioletred" },
  { id: "Professor", x: 4.1, y: 4.9, z: 3.5, color: "mediumslateblue" },
  { id: "Author", x: 4.0, y: 3.9, z: 3.2, color: "peru" },
  {
    id: "Independent Researcher",
    x: 3.6,
    y: 3.8,
    z: 4.4,
    color: "darkslateblue",
  },

  { id: "Quant Developer", x: 2.8, y: 2.2, z: 3.4, color: "darkslategray" },
  { id: "Product Director", x: 4.2, y: 3.0, z: 2.6, color: "lightseagreen" },

  { id: "Married", x: 2.7, y: 1.5, z: 1.5, color: "tomato" },
  { id: "Parent", x: 3.1, y: 1.2, z: 1.2, color: "orchid" },
  { id: "Caregiver", x: 3.0, y: 0.7, z: 1.0, color: "rosybrown" },
  { id: "Career Break", x: 2.5, y: 0.2, z: 0.8, color: "burlywood" },
  { id: "Health Setback", x: 2.0, y: -0.2, z: 0.3, color: "firebrick" },
  { id: "Sabbatical", x: 5.2, y: 4.6, z: 5.1, color: "lightgoldenrodyellow" },
  { id: "Digital Nomad", x: 3.5, y: 2.0, z: 1.0, color: "cadetblue" },
  { id: "Community Organizer", x: 4.6, y: 2.2, z: 2.0, color: "olive" },

  { id: "Retired Early", x: 8.2, y: 8.1, z: 7.2, color: "silver" },
  { id: "Retired", x: 8, y: 8, z: 8, color: "gray" },
  { id: "Deceased", x: 9, y: 9, z: 9, color: "black" },
];

const initialLinks = [
  // Core spine
  { source: "Now", target: "College Graduate" },
  { source: "College Graduate", target: "Software Engineer" },
  { source: "Software Engineer", target: "Senior Software Engineer" },
  { source: "Senior Software Engineer", target: "Architect" },
  { source: "Architect", target: "CTO" },
  { source: "CTO", target: "CEO" },
  { source: "CEO", target: "Founder" },
  { source: "Founder", target: "Retired" },
  { source: "Retired", target: "Deceased" },

  // Early forks
  { source: "Now", target: "Bootcamp Grad" },
  { source: "Now", target: "Gap Year Traveler" },
  { source: "College Graduate", target: "Grad School (MS CS)" },
  { source: "College Graduate", target: "Relocated to SF" },
  { source: "College Graduate", target: "Relocated to NYC" },

  // SWE branches
  { source: "Bootcamp Grad", target: "Software Engineer" },
  { source: "Gap Year Traveler", target: "Software Engineer" },
  { source: "Grad School (MS CS)", target: "Data Scientist" },
  { source: "Relocated to SF", target: "Startup Engineer #3" },
  { source: "Relocated to NYC", target: "Quant Developer" },
  { source: "Software Engineer", target: "Startup Engineer #3" },
  { source: "Software Engineer", target: "Product Manager" },
  { source: "Software Engineer", target: "Data Scientist" },
  { source: "Software Engineer", target: "Security Engineer" },
  { source: "Software Engineer", target: "Game Developer" },

  // Senior/lead forks
  { source: "Senior Software Engineer", target: "Tech Lead" },
  { source: "Senior Software Engineer", target: "Staff Engineer" },
  { source: "Senior Software Engineer", target: "Open Source Maintainer" },
  { source: "Senior Software Engineer", target: "Engineering Manager" },

  // Architect forks
  { source: "Architect", target: "Principal Engineer" },
  { source: "Architect", target: "Platform Architect" },
  { source: "Engineering Manager", target: "Director of Engineering" },
  { source: "Tech Lead", target: "Product Director" },

  // Exec / alt-paths
  { source: "CTO", target: "CISO" },
  { source: "CTO", target: "Angel Investor" },
  { source: "Founder", target: "Serial Founder" },
  { source: "Founder", target: "Acquired" },
  { source: "Founder", target: "Failed Startup" },
  { source: "Founder", target: "Startup IPO" },
  { source: "Acquired", target: "Director of Engineering" },
  { source: "Serial Founder", target: "VC Partner" },
  { source: "Angel Investor", target: "VC Partner" },
  { source: "Failed Startup", target: "Freelancer" },
  { source: "Failed Startup", target: "Back to SWE" },
  { source: "Back to SWE", target: "Senior Software Engineer" },
  { source: "Director of Engineering", target: "CTO" },

  // Impact / public sector
  { source: "CTO", target: "Nonprofit Founder" },
  { source: "Security Engineer", target: "Government Tech Fellow" },
  { source: "Nonprofit Founder", target: "Community Organizer" },

  // Academic / research branches
  { source: "Grad School (MS CS)", target: "PhD" },
  { source: "PhD", target: "AI Researcher" },
  { source: "PhD", target: "Professor" },
  { source: "Open Source Maintainer", target: "Independent Researcher" },
  { source: "Independent Researcher", target: "Author" },

  // Life events (offshoots that can happen in parallel)
  { source: "Software Engineer", target: "Married" },
  { source: "Married", target: "Parent" },
  { source: "Parent", target: "Career Break" },
  { source: "Career Break", target: "Back to SWE" },
  { source: "Married", target: "Caregiver" },
  { source: "Caregiver", target: "Career Break" },
  { source: "Software Engineer", target: "Digital Nomad" },

  // Health & sabbatical
  { source: "Software Engineer", target: "Health Setback" },
  { source: "Health Setback", target: "Career Break" },
  { source: "CTO", target: "Sabbatical" },
  { source: "Sabbatical", target: "Founder" },

  // Retirement variants
  { source: "Startup IPO", target: "Retired Early" },
  { source: "VC Partner", target: "Retired" },
  { source: "Retired Early", target: "Retired" },
];

export default function LifeWrap({ user }: { user: User }) {
  const [config, setConfig] = useState({
    prompt: "",
    positivity: -1,
    time_in_months: 1,
    type: "",
    num_nodes: 1,
  });

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
        <Life
          user={user}
          setHighlightedPath={setHighlightedPathState}
          nodes={nodes}
          links={links}
        />
      </div>
    </div>
  );
}
