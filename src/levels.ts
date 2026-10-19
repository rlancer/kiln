export type Level = {
  id: string;
  name: string;
  hint: string;
  heat: number;
  width: number;
  height: number;
  rows: string[];
};

const H = 15;

type Spec = {
  id: string;
  name: string;
  hint: string;
  heat: number;
  width: number;
  pits?: { x: number; w: number; socket?: boolean; spikes?: boolean }[];
  walls?: { x: number; w: number; top: number }[];
  platforms?: { x: number; y: number; w: number }[];
  marks?: { x: number; y: number }[];
  props: { x: number; y: number; ch: string }[];
};

function build(spec: Spec): Level {
  const rows = Array.from({ length: H }, () => Array<string>(spec.width).fill("."));
  const set = (x: number, y: number, ch: string) => {
    if (y < 0 || y >= H || x < 0 || x >= spec.width) {
      throw new Error(`${spec.id}: '${ch}' at ${x},${y} is outside ${spec.width}x${H}`);
    }
    rows[y]![x] = ch;
  };

  for (let x = 0; x < spec.width; x++) {
    set(x, 13, "#");
    set(x, 14, "#");
  }
  for (const pit of spec.pits ?? []) {
    for (let i = 0; i < pit.w; i++) {
      const x = pit.x + i;
      const lip = i === 0 && pit.socket === true;
      set(x, 13, lip ? "s" : pit.spikes ? "^" : ".");
      if (!pit.spikes) set(x, 14, ".");
    }
  }
  for (const wall of spec.walls ?? []) {
    for (let x = wall.x; x < wall.x + wall.w; x++) {
      for (let y = wall.top; y <= 13; y++) set(x, y, "#");
    }
  }
  for (const plat of spec.platforms ?? []) {
    for (let i = 0; i < plat.w; i++) set(plat.x + i, plat.y, "#");
  }
  for (const mark of spec.marks ?? []) set(mark.x, mark.y, "s");
  for (const prop of spec.props) set(prop.x, prop.y, prop.ch);

  return {
    id: spec.id,
    name: spec.name,
    hint: spec.hint,
    heat: spec.heat,
    width: spec.width,
    height: H,
    rows: rows.map((row) => row.join("")),
  };
}

function coins(list: [number, number][]): Spec["props"] {
  return list.map(([x, y]) => ({ x, y, ch: "c" }));
}

export const LEVELS: Level[] = [
  build({
    id: "kindling",
    name: "Kindling",
    hint: "Bump the cracked brick. Set it in the mark.",
    heat: 0.35,
    width: 52,
    pits: [
      { x: 12, w: 4, socket: true, spikes: true },
      { x: 34, w: 3, socket: false, spikes: true },
    ],
    props: [
      { x: 3, y: 12, ch: "p" },
      { x: 6, y: 10, ch: "?" },
      { x: 28, y: 12, ch: "f" },
      { x: 46, y: 12, ch: "x" },
      ...coins([
        [18, 12],
        [20, 11],
        [22, 12],
        [35, 11],
        [36, 10],
      ]),
    ],
  }),
  build({
    id: "hearth",
    name: "Hearth",
    hint: "A mark on the wall will hold.",
    heat: 0.5,
    width: 56,
    pits: [{ x: 14, w: 3, socket: false, spikes: true }],
    walls: [{ x: 40, w: 16, top: 9 }],
    marks: [{ x: 39, y: 12 }],
    props: [
      { x: 3, y: 12, ch: "p" },
      { x: 8, y: 10, ch: "?" },
      { x: 24, y: 12, ch: "e" },
      { x: 32, y: 12, ch: "f" },
      { x: 44, y: 8, ch: "c" },
      { x: 46, y: 8, ch: "c" },
      { x: 50, y: 8, ch: "x" },
    ],
  }),
  build({
    id: "bellows",
    name: "Bellows",
    hint: "The coil throws you. Coins lift the grate.",
    heat: 0.62,
    width: 58,
    pits: [{ x: 10, w: 4, socket: true, spikes: true }],
    platforms: [
      { x: 20, y: 8, w: 5 },
      { x: 26, y: 8, w: 2 },
    ],
    props: [
      { x: 3, y: 12, ch: "p" },
      { x: 6, y: 10, ch: "?" },
      { x: 18, y: 12, ch: "*" },
      { x: 21, y: 7, ch: "c" },
      { x: 23, y: 7, ch: "c" },
      { x: 24, y: 7, ch: "c" },
      { x: 27, y: 7, ch: "z" },
      { x: 36, y: 12, ch: "f" },
      { x: 46, y: 9, ch: "G" },
      { x: 46, y: 10, ch: "G" },
      { x: 46, y: 11, ch: "G" },
      { x: 46, y: 12, ch: "G" },
      { x: 52, y: 12, ch: "x" },
    ],
  }),
  build({
    id: "twin",
    name: "Twin pits",
    hint: "The high mouth is another way through.",
    heat: 0.45,
    width: 68,
    pits: [
      { x: 12, w: 4, socket: true, spikes: true },
      { x: 40, w: 4, socket: true, spikes: true },
    ],
    platforms: [{ x: 22, y: 9, w: 8 }],
    marks: [{ x: 21, y: 12 }],
    props: [
      { x: 3, y: 12, ch: "p" },
      { x: 7, y: 10, ch: "?" },
      { x: 19, y: 10, ch: "?" },
      { x: 25, y: 8, ch: "z" },
      { x: 34, y: 12, ch: "f" },
      { x: 48, y: 10, ch: "?" },
      { x: 62, y: 12, ch: "x" },
      ...coins([
        [23, 8],
        [27, 8],
        [54, 12],
        [56, 11],
      ]),
    ],
  }),
  build({
    id: "patrol",
    name: "Patrol",
    hint: "Come down on them, or go over the pit.",
    heat: 0.4,
    width: 54,
    pits: [{ x: 22, w: 4, socket: true, spikes: true }],
    props: [
      { x: 2, y: 12, ch: "p" },
      { x: 5, y: 10, ch: "?" },
      { x: 12, y: 12, ch: "e" },
      { x: 30, y: 12, ch: "f" },
      { x: 36, y: 12, ch: "e" },
      { x: 48, y: 12, ch: "x" },
      ...coins([
        [16, 11],
        [40, 11],
        [42, 12],
      ]),
    ],
  }),
  build({
    id: "draft",
    name: "Draft",
    hint: "Ride the shelf across. Then set the brick.",
    heat: 0.48,
    width: 56,
    pits: [
      { x: 14, w: 10, spikes: true },
      { x: 34, w: 4, socket: true, spikes: true },
    ],
    props: [
      { x: 3, y: 12, ch: "p" },
      { x: 7, y: 10, ch: "?" },
      { x: 15, y: 12, ch: "=" },
      { x: 28, y: 12, ch: "f" },
      { x: 31, y: 12, ch: "e" },
      { x: 40, y: 11, ch: "w" },
      { x: 50, y: 12, ch: "x" },
      ...coins([
        [29, 11],
        [44, 11],
        [46, 10],
      ]),
    ],
  }),
  build({
    id: "gate",
    name: "Ember gate",
    hint: "Step, then cross.",
    heat: 0.7,
    width: 64,
    walls: [{ x: 18, w: 12, top: 9 }],
    marks: [{ x: 17, y: 12 }],
    pits: [{ x: 36, w: 4, socket: true, spikes: true }],
    props: [
      { x: 2, y: 12, ch: "p" },
      { x: 6, y: 10, ch: "?" },
      { x: 24, y: 8, ch: "f" },
      { x: 22, y: 8, ch: "c" },
      { x: 26, y: 8, ch: "c" },
      { x: 32, y: 10, ch: "?" },
      { x: 48, y: 12, ch: "e" },
      { x: 58, y: 12, ch: "x" },
    ],
  }),
  build({
    id: "kiln",
    name: "The kiln",
    hint: "Three mouths. One brick at a time.",
    heat: 0.9,
    width: 80,
    pits: [
      { x: 14, w: 4, socket: true, spikes: true },
      { x: 32, w: 4, socket: true, spikes: true },
      { x: 50, w: 4, socket: true, spikes: true },
    ],
    walls: [{ x: 66, w: 14, top: 9 }],
    marks: [{ x: 65, y: 12 }],
    props: [
      { x: 2, y: 12, ch: "p" },
      { x: 6, y: 10, ch: "?" },
      { x: 24, y: 10, ch: "?" },
      { x: 26, y: 12, ch: "e" },
      { x: 38, y: 12, ch: "f" },
      { x: 42, y: 10, ch: "?" },
      { x: 44, y: 12, ch: "e" },
      { x: 58, y: 10, ch: "?" },
      { x: 70, y: 8, ch: "c" },
      { x: 72, y: 8, ch: "c" },
      { x: 74, y: 8, ch: "x" },
    ],
  }),
  build({
    id: "cinder",
    name: "Cinder path",
    hint: "Nothing here keeps the heat.",
    heat: 0.55,
    width: 48,
    pits: [
      { x: 14, w: 4, socket: false, spikes: true },
      { x: 30, w: 4, socket: false, spikes: true },
    ],
    props: [
      { x: 2, y: 12, ch: "p" },
      { x: 6, y: 10, ch: "?" },
      { x: 22, y: 10, ch: "?" },
      { x: 22, y: 12, ch: "f" },
      { x: 38, y: 10, ch: "?" },
      { x: 44, y: 12, ch: "x" },
      ...coins([
        [10, 11],
        [11, 10],
        [18, 11],
        [19, 10],
        [26, 11],
        [34, 11],
        [35, 10],
        [41, 12],
      ]),
    ],
  }),
];

export const levelById: Record<string, Level> = Object.fromEntries(LEVELS.map((level) => [level.id, level]));
