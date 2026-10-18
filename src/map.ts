export const NODES = {
  kindling: { x: 46, y: 188, name: "Kindling" },
  hearth: { x: 110, y: 188, name: "Hearth" },
  twin: { x: 174, y: 164, name: "Twin pits" },
  patrol: { x: 252, y: 188, name: "Patrol" },
  cinder: { x: 174, y: 96, name: "Cinder path" },
  gate: { x: 252, y: 96, name: "Ember gate" },
  kiln: { x: 252, y: 36, name: "The kiln" },
} as const;

export type NodeId = keyof typeof NODES;

type Gate = "always" | "secret";

export const LINKS: { from: NodeId; to: NodeId; gate: Gate }[] = [
  { from: "kindling", to: "hearth", gate: "always" },
  { from: "hearth", to: "twin", gate: "always" },
  { from: "twin", to: "patrol", gate: "always" },
  { from: "patrol", to: "gate", gate: "always" },
  { from: "gate", to: "kiln", gate: "always" },
  { from: "twin", to: "cinder", gate: "secret" },
  { from: "cinder", to: "gate", gate: "always" },
];

const ORDER: NodeId[] = ["kindling", "hearth", "twin", "patrol", "gate", "kiln", "cinder"];

export type Progress = {
  cleared: NodeId[];
  secrets: NodeId[];
  unlocked: NodeId[];
};

function isNode(id: string): id is NodeId {
  return id in NODES;
}

export function derive(cleared: readonly string[], secrets: readonly string[]): Progress {
  const clearedSet = new Set(cleared.filter(isNode));
  const secretSet = new Set(secrets.filter(isNode));
  const unlocked = new Set<NodeId>(["kindling"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const link of LINKS) {
      if (unlocked.has(link.to)) continue;
      const open = clearedSet.has(link.from) && (link.gate === "always" || secretSet.has(link.from));
      if (open) {
        unlocked.add(link.to);
        grew = true;
      }
    }
  }
  return {
    cleared: ORDER.filter((id) => clearedSet.has(id)),
    secrets: ORDER.filter((id) => secretSet.has(id)),
    unlocked: ORDER.filter((id) => unlocked.has(id)),
  };
}

export function isVisible(id: NodeId, progress: Progress): boolean {
  if (progress.unlocked.includes(id)) return true;
  return LINKS.some(
    (link) =>
      link.to === id &&
      link.gate === "always" &&
      (progress.unlocked.includes(link.from) || progress.cleared.includes(link.from)),
  );
}

export function neighbors(id: NodeId, progress: Progress): NodeId[] {
  const out: NodeId[] = [];
  for (const link of LINKS) {
    if (link.from === id && progress.unlocked.includes(link.to)) out.push(link.to);
    if (link.to === id && progress.unlocked.includes(link.from)) out.push(link.from);
  }
  return out;
}

export function pickNeighbor(id: NodeId, dirX: number, dirY: number, progress: Progress): NodeId | null {
  let best: NodeId | null = null;
  let bestDot = 0.45;
  const from = NODES[id];
  for (const next of neighbors(id, progress)) {
    const node = NODES[next];
    const dx = node.x - from.x;
    const dy = node.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const dot = (dx / len) * dirX + (dy / len) * dirY;
    if (dot > bestDot) {
      bestDot = dot;
      best = next;
    }
  }
  return best;
}

export function noteClear(progress: Progress, id: NodeId, secret: boolean): Progress {
  const cleared = progress.cleared.includes(id) ? progress.cleared : [...progress.cleared, id];
  const secrets = secret && !progress.secrets.includes(id) ? [...progress.secrets, id] : progress.secrets;
  return derive(cleared, secrets);
}

export function resumeNode(progress: Progress): NodeId {
  for (const id of ORDER) {
    if (progress.unlocked.includes(id) && !progress.cleared.includes(id)) return id;
  }
  return progress.unlocked.includes("kiln") ? "kiln" : "kindling";
}
