export interface BlenderInstall {
  executable: string;
  root: string;
  version: string | null;
  python: string | null;
}

export interface BlenderObject {
  name: string;
  type: string;
  location: [number, number, number];
  parent: string | null;
  data: string | null;
}

export interface BlendScene {
  file: string;
  version: string;
  scenes: {
    name: string;
    frameStart: number;
    frameEnd: number;
    camera: string | null;
  }[];
  objects: BlenderObject[];
  meshes: string[];
  materials: string[];
  collections: string[];
}

export interface RenderOptions {
  output?: string;
  frame?: number;
  animation?: boolean;
  engine?: "CYCLES" | "BLENDER_EEVEE_NEXT" | "BLENDER_WORKBENCH" | (string & {});
  format?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
