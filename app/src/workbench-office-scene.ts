export interface Point {
  x: number;
  y: number;
}

export interface Desk {
  position: Point;
  chair: Point;
  aisle: number;
}

export type ScreenMode = "typing" | "thinking" | "reading" | "waiting" | "paused" | "idle" | "sleep" | "off" | "stale";

export const sceneSize = { width: 944, height: 568 };
export const hall = 7.38;
export const water = { x: 8.08, y: 2.74 };
export const restroom = { x: 8.75, y: 1.06 };
export const lounge = { x: 8.12, y: 5.18 };

export const desks: Desk[] = [0, 1, 2].flatMap((column) => [0, 1].map((row) => {
  const x = 0.68 + column * 2.16;
  const y = 1.18 + row * 2.62;
  return { position: { x, y }, chair: { x: x + 0.77, y: y + 1.28 }, aisle: y + 1.77 };
}));

const room = { width: 10.1, depth: 7, wall: 1.78 };
type Vertex = [x: number, y: number, z?: number];
type Surface = [top: string, front: string, side: string];
const wood: Surface = ["#e7be8a", "#bd8c6a", "#a7795d"];
const legs: Surface = ["#ae8265", "#946b55", "#77564a"];
const screenCase: Surface = ["#465461", "#293841", "#1e2c35"];
const paper: Surface = ["#fff4dc", "#dcc8a8", "#c4b191"];
const teal: Surface = ["#89b6b7", "#588a95", "#3f7180"];
const wallWhite: Surface = ["#f5f2e9", "#deded7", "#bbccc8"];

export function project(x: number, y: number, z = 0): Point {
  return { x: 346 + x * 56 - y * 46, y: 149 + x * 20 + y * 27 - z * 70 };
}

export function monitorPosition(desk: Desk, laptop: boolean): Point {
  return project(desk.position.x + 0.92, desk.position.y + 0.28, laptop ? 1.07 : 1.25);
}

export class OfficeScene {
  private readonly backdrop = document.createElement("canvas");

  constructor(readonly context: CanvasRenderingContext2D) {
    this.backdrop.width = sceneSize.width;
    this.backdrop.height = sceneSize.height;
    const painter = this.backdrop.getContext("2d")!;
    this.drawRoom(painter);
  }

  begin(): void {
    this.context.drawImage(this.backdrop, 0, 0);
  }

  private drawRoom(c: CanvasRenderingContext2D): void {
    const sky = c.createLinearGradient(0, 0, 0, sceneSize.height);
    sky.addColorStop(0, "#e8eeef");
    sky.addColorStop(1, "#f7ede1");
    c.fillStyle = sky;
    c.fillRect(0, 0, sceneSize.width, sceneSize.height);
    const { width, depth, wall } = room;
    c.save();
    c.shadowColor = "#46547055";
    c.shadowBlur = 26;
    c.shadowOffsetY = 14;
    face(c, "#75828a", [0, 0, -0.16], [width, 0, -0.16], [width, depth, -0.16], [0, depth, -0.16]);
    c.restore();
    block(c, 0, 0, width, depth, 0.16, ["#d3d4c8", "#879797", "#687f86"], -0.16);
    const floorColors = ["#d5d9ce", "#dce0d5", "#cbd3ce", "#d3d8d2", "#e2e2d6"];
    for (let y = 0; y < depth; y += 0.7) {
      for (let x = 0; x < width; x += 0.72) {
        const index = (Math.floor(x * 2 + y * 5) * 7) % floorColors.length;
        face(c, floorColors[index], [x, y], [Math.min(x + 0.705, width), y],
          [Math.min(x + 0.705, width), Math.min(y + 0.685, depth)], [x, Math.min(y + 0.685, depth)]);
      }
    }
    face(c, "#f4eee2", [0, 0], [width, 0], [width, 0, wall], [0, 0, wall]);
    face(c, "#d7e1dc", [0, 0], [0, depth], [0, depth, wall], [0, 0, wall]);
    face(c, "#c2cfc9", [0, 0], [width, 0], [width, 0, 0.07], [0, 0, 0.07]);
    face(c, "#aebfb9", [0, 0], [0, depth], [0, depth, 0.07], [0, 0, 0.07]);
    backWindow(c, 0.8, 1.82);
    backWindow(c, 3.34, 1.82);
    backWindow(c, 5.86, 1.5);
    for (const y of [1, 3.82]) {
      face(c, "#faf4e6", [0, y, 0.66], [0, y + 1.48, 0.66], [0, y + 1.48, 1.48], [0, y, 1.48]);
      face(c, "#99c7d2", [0, y + 0.06, 0.72], [0, y + 1.42, 0.72], [0, y + 1.42, 1.42], [0, y + 0.06, 1.42]);
      face(c, "#c9e5e1", [0, y + 0.06, 0.73], [0, y + 1.42, 0.73], [0, y + 1.42, 1.05], [0, y + 0.06, 0.9]);
      face(c, "#f7f0e4", [0, y + 0.72, 0.68], [0, y + 0.77, 0.68], [0, y + 0.77, 1.47], [0, y + 0.72, 1.47]);
    }
    face(c, "#bbad99", [8.17, 0, 0.01], [9.55, 0, 0.01], [9.55, 0, 1.55], [8.17, 0, 1.55]);
    face(c, "#91b3b3", [8.24, 0.01, 0.01], [9.48, 0.01, 0.01], [9.48, 0.01, 1.48], [8.24, 0.01, 1.48]);
    face(c, "#bad0c7", [8.44, 0.02, 0.93], [9.28, 0.02, 0.93], [9.28, 0.02, 1.27], [8.44, 0.02, 1.27]);
    block(c, 9.25, 0.025, 0.11, 0.068, 0.06, wood, 0.66);

    face(c, "#afc4c2", [7.73, 3.61], [9.86, 3.61], [9.86, 6.36], [7.73, 6.36]);
    face(c, "#c3d4cf", [7.84, 3.73], [9.73, 3.73], [9.73, 6.22], [7.84, 6.22]);
    face(c, "#efe3cb", [7.85, 0.79], [9.66, 0.79], [9.66, 1.24], [7.85, 1.24]);
    for (const x of [0.55, 2.72, 4.88]) {
      face(c, "#d7d9ce", [x, 2.98], [x + 1.88, 2.98], [x + 1.88, 3.34], [x, 3.34]);
    }
  }

  furniture(): { depth: number; draw: () => void }[] {
    const c = this.context;
    return [
      { depth: 0.95, draw: () => plant(c, 0.35, 0.49, 0.28) },
      { depth: 6.4, draw: () => plant(c, 0.4, 5.92, 0.33) },
      { depth: 8.6, draw: () => {
        block(c, 6.48, 1.05, 0.74, 0.45, 0.5, wood);
        block(c, 6.54, 1.08, 0.47, 0.32, 0.13, screenCase, 0.5);
        block(c, 6.58, 1.14, 0.36, 0.22, 0.022, paper, 0.635);
      } },
      { depth: 11.56, draw: () => {
        block(c, 9.14, 1.93, 0.68, 0.62, 0.68, wallWhite);
        block(c, 9.29, 2.04, 0.36, 0.36, 0.34, ["#b1e0e6", "#80b9cc", "#659dae"], 0.68);
        block(c, 9.23, 2.55, 0.18, 0.08, 0.08, teal, 0.46);
        block(c, 9.48, 2.55, 0.18, 0.08, 0.08, ["#e2a189", "#ce826a", "#a26457"], 0.46);
      } },
      { depth: 12.46, draw: () => plant(c, 9.7, 2.69, 0.3) },
      { depth: 13.84, draw: () => {
        block(c, 8.92, 3.45, 0.84, 2.04, 0.27, teal);
        block(c, 9.54, 3.45, 0.24, 2.04, 0.48, teal, 0.27);
        block(c, 8.93, 3.45, 0.62, 0.21, 0.24, teal, 0.27);
        block(c, 8.93, 5.28, 0.62, 0.21, 0.24, teal, 0.27);
        block(c, 9.17, 3.72, 0.29, 0.38, 0.16, paper, 0.275);
      } },
      { depth: 13.06, draw: () => {
        block(c, 7.91, 4.12, 0.75, 0.65, 0.22, legs);
        block(c, 7.82, 4.06, 0.94, 0.79, 0.09, wood, 0.22);
        block(c, 8.06, 4.19, 0.2, 0.28, 0.034, paper, 0.31);
        block(c, 8.46, 4.32, 0.11, 0.1, 0.12, wallWhite, 0.31);
      } },
      { depth: 15.75, draw: () => plant(c, 9.54, 6.12, 0.36) },
    ];
  }

  desk(desk: Desk, laptop: boolean, selected: boolean): void {
    const c = this.context;
    const { x, y } = desk.position;
    if (selected) {
      face(c, "#a7cfc4", [x - 0.12, y - 0.15], [x + 1.82, y - 0.15], [x + 1.82, y + 1.58], [x - 0.12, y + 1.58]);
      face(c, "#c9e3d6", [x - 0.06, y - 0.09], [x + 1.76, y - 0.09], [x + 1.76, y + 1.52], [x - 0.06, y + 1.52]);
    }
    for (const dx of [0.07, 1.53]) {
      for (const dy of [0.08, 0.76]) block(c, x + dx, y + dy, 0.1, 0.1, 0.68, legs);
    }
    block(c, x, y, 1.7, 0.88, 0.085, wood, 0.65);
    block(c, x + 0.17, y + 0.47, 0.25, 0.26, 0.018, paper, 0.735);
    block(c, x + 1.42, y + 0.52, 0.113, 0.1, 0.12, wallWhite, 0.735);
    if (laptop) {
      block(c, x + 0.54, y + 0.19, 0.75, 0.45, 0.035, ["#b6c0c6", "#7b8992", "#647884"], 0.735);
    } else {
      block(c, x + 0.79, y + 0.22, 0.24, 0.29, 0.12, screenCase, 0.735);
      block(c, x + 0.66, y + 0.57, 0.55, 0.16, 0.02, screenCase, 0.735);
    }
    block(c, x + 0.49, y + 0.21, 0.87, 0.08, laptop ? 0.36 : 0.43, screenCase, laptop ? 0.76 : 0.845);
  }

  chair(desk: Desk): void {
    const { x, y } = desk.chair;
    const c = this.context;
    block(c, x - 0.23, y - 0.15, 0.46, 0.36, 0.12, screenCase);
    block(c, x - 0.24, y - 0.18, 0.48, 0.43, 0.12, teal, 0.25);
    block(c, x - 0.24, y + 0.15, 0.48, 0.1, 0.32, teal, 0.36);
  }

  screen(desk: Desk, laptop: boolean, mode: ScreenMode, seconds: number): void {
    const { x, y } = desk.position;
    const z = laptop ? 0.798 : 0.884;
    const screenHeight = laptop ? 0.28 : 0.35;
    const origin = project(x + 0.54, y + 0.292, z + screenHeight);
    const c = this.context;
    const width = 43;
    const height = screenHeight * 70;
    c.save();
    c.transform(1, 20 / 56, 0, 1, origin.x, origin.y);
    c.beginPath();
    c.rect(0, 0, width, height);
    c.clip();
    const colors = screenColors[mode];
    c.fillStyle = colors[0];
    c.fillRect(0, 0, width, height);
    c.fillStyle = colors[1];
    if (mode === "thinking") {
      for (let dot = 0; dot < 3; dot++) {
        const bounce = Math.max(0, Math.sin((seconds * 1.2 - dot * 0.16) * Math.PI * 2));
        c.beginPath();
        c.arc(13 + dot * 8, height / 2 - 2 * bounce, 1.65 + 0.35 * bounce, 0, Math.PI * 2);
        c.fill();
      }
    } else if (mode !== "sleep" && mode !== "off") {
      const offset = mode === "typing" ? (seconds * 8) % 15 : 0;
      for (let line = 0; line < 7; line++) {
        c.fillRect(4, 4 + line * 5 - offset, [26, 15, 33][line % 3], 1.6);
      }
      if (mode === "reading") {
        c.fillStyle = "#a7fdf66b";
        c.fillRect(2, 3 + Math.floor(seconds * 3) % 4 * 5, 38, 3.7);
      }
    }
    c.restore();
  }

  shadow(position: Point): void {
    const p = project(position.x, position.y);
    const c = this.context;
    c.fillStyle = "#46556338";
    c.beginPath();
    c.ellipse(p.x, p.y + 1, 14, 5, 0.14, 0, Math.PI * 2);
    c.fill();
  }
}

const screenColors: Record<ScreenMode, [string, string]> = {
  typing: ["#204843", "#9af2d1"], thinking: ["#21484c", "#c7f6ec"], reading: ["#20434d", "#9cdce3"],
  waiting: ["#645233", "#ebc67f"], paused: ["#64463d", "#e5aa9a"], idle: ["#43555d", "#899e9f"],
  sleep: ["#272f3b", "#272f3b"], off: ["#242833", "#242833"], stale: ["#4d4c50", "#aca9b0"],
};

function face(c: CanvasRenderingContext2D, color: string, ...vertices: Vertex[]): void {
  c.fillStyle = color;
  c.beginPath();
  for (const [x, y, z] of vertices) {
    const p = project(x, y, z);
    c.lineTo(p.x, p.y);
  }
  c.closePath();
  c.fill();
}

function block(c: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, colors: Surface, z = 0): void {
  const right = x + w, near = y + d, top = z + h;
  face(c, colors[1], [x, near, z], [right, near, z], [right, near, top], [x, near, top]);
  face(c, colors[2], [right, y, z], [right, near, z], [right, near, top], [right, y, top]);
  face(c, colors[0], [x, y, top], [right, y, top], [right, near, top], [x, near, top]);
}

function backWindow(c: CanvasRenderingContext2D, x: number, w: number): void {
  const plane = (color: string, left: number, right: number, low: number, high: number) =>
    face(c, color, [left, 0.008, low], [right, 0.008, low], [right, 0.008, high], [left, 0.008, high]);
  plane("#fff9ea", x, x + w, 0.75, 1.49);
  plane("#9dcbdc", x + 0.06, x + w - 0.06, 0.81, 1.43);
  const sun = project(x + 0.36, 0.008, 1.26);
  c.fillStyle = "#fff2b5";
  c.beginPath();
  c.ellipse(sun.x, sun.y, 6, 6, 0, 0, Math.PI * 2);
  c.fill();
  plane("#bad9d1", x + 0.06, x + w - 0.06, 0.81, 0.99);
  plane("#f9f1dd", x + w / 2 - 0.022, x + w / 2 + 0.022, 0.77, 1.47);
  plane("#fff7e6", x + 0.03, x + w - 0.03, 0.75, 0.80);
}

function plant(c: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  block(c, x, y, w, w, w * 0.85, ["#c99074", "#ae735e", "#895d51"]);
  const top = project(x + w / 2, y + w / 2, w * 2.35);
  for (const [dx, dy, rx, ry, angle, color] of [
    [-5, 6, 8, 3.8, 0.46, "#548c62"], [5, 5, 7.5, 3.5, -0.52, "#6a9f69"],
    [0, 1, 6, 3.8, -0.32, "#86ad70"], [-2, -4, 4.5, 3, 0.4, "#73a761"],
  ] as const) {
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(top.x + dx, top.y + dy, rx, ry, angle, 0, Math.PI * 2);
    c.fill();
  }
}
