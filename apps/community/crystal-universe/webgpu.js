// SPDX-License-Identifier: Apache-2.0
const shader = /* wgsl */ `
struct Camera { view_projection: mat4x4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
};
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};
@vertex fn vertex_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = camera.view_projection * vec4<f32>(input.position, 1.0);
  let light = max(dot(normalize(input.normal), normalize(vec3<f32>(-0.4, 0.8, 0.6))), 0.0);
  output.color = input.color * (0.42 + light * 0.58);
  return output;
}
@fragment fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 1.0);
}`;

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function multiply(a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++)
      for (let index = 0; index < 4; index++)
        result[column * 4 + row] += a[index * 4 + row] * b[column * 4 + index];
  return result;
}

function cameraMatrix(aspect) {
  const eye = [0, 4.1, 8.4];
  const target = [0, 1.1, 0];
  const z = normalize(eye.map((value, index) => value - target[index]));
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  const view = new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
  const near = 0.1;
  const far = 100;
  const f = 1 / Math.tan((55 * Math.PI) / 360);
  const projection = new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    far / (near - far),
    -1,
    0,
    0,
    (near * far) / (near - far),
    0,
  ]);
  return multiply(projection, view);
}

function rgb(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "63e6ff";
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function cube(vertices, center, size, color) {
  const [x, y, z] = center;
  const [sx, sy, sz] = size.map((value) => value / 2);
  const faces = [
    [
      [0, 0, 1],
      [
        [-sx, -sy, sz],
        [sx, -sy, sz],
        [sx, sy, sz],
        [-sx, sy, sz],
      ],
    ],
    [
      [0, 0, -1],
      [
        [sx, -sy, -sz],
        [-sx, -sy, -sz],
        [-sx, sy, -sz],
        [sx, sy, -sz],
      ],
    ],
    [
      [1, 0, 0],
      [
        [sx, -sy, sz],
        [sx, -sy, -sz],
        [sx, sy, -sz],
        [sx, sy, sz],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-sx, -sy, -sz],
        [-sx, -sy, sz],
        [-sx, sy, sz],
        [-sx, sy, -sz],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-sx, sy, sz],
        [sx, sy, sz],
        [sx, sy, -sz],
        [-sx, sy, -sz],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-sx, -sy, -sz],
        [sx, -sy, -sz],
        [sx, -sy, sz],
        [-sx, -sy, sz],
      ],
    ],
  ];
  for (const [normal, points] of faces)
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const point = points[index];
      vertices.push(x + point[0], y + point[1], z + point[2], ...normal, ...color);
    }
}

function addFighter(
  vertices,
  x,
  feet,
  outfit,
  skin,
  hair,
  race = "saiyan",
  hairstyle = "spiky",
  transformed = false,
  build = "athletic",
  height = 1,
) {
  const width = build === "slim" ? 0.84 : build === "broad" ? 1.2 : 1;
  const part = (center, size, color) =>
    cube(
      vertices,
      [x + (center[0] - x) * width, feet + (center[1] - feet) * height, center[2]],
      [size[0] * width, size[1] * height, size[2] * width],
      color,
    );
  const body = rgb(transformed ? "#ffd475" : outfit);
  const flesh = rgb(skin);
  const coiffure = rgb(hair);
  const legHeight = 0.43;
  part([x - 0.13, feet + legHeight / 2, 0], [0.18, legHeight, 0.2], body);
  part([x + 0.13, feet + legHeight / 2, 0], [0.18, legHeight, 0.2], body);
  part([x, feet + 0.94, 0], [0.48, 0.57, 0.3], body);
  part([x - 0.34, feet + 0.9, 0], [0.16, 0.5, 0.19], body);
  part([x + 0.34, feet + 0.9, 0], [0.16, 0.5, 0.19], body);
  part([x, feet + 1.39, 0], [0.34, 0.35, 0.31], flesh);
  if (race === "namekian") {
    part([x - 0.11, feet + 1.73, 0], [0.055, 0.3, 0.055], flesh);
    part([x + 0.11, feet + 1.73, 0], [0.055, 0.3, 0.055], flesh);
  } else if (race === "frieza") {
    part([x - 0.11, feet + 1.68, 0], [0.06, 0.28, 0.06], flesh);
    part([x + 0.11, feet + 1.68, 0], [0.06, 0.28, 0.06], flesh);
  } else if (race === "android") {
    part([x - 0.22, feet + 1.39, 0], [0.1, 0.14, 0.12], rgb("#98efff"));
    part([x + 0.22, feet + 1.39, 0], [0.1, 0.14, 0.12], rgb("#98efff"));
  } else if (race === "majin") {
    part([x, feet + 1.75, 0], [0.08, 0.4, 0.08], flesh);
  } else if (hairstyle === "crest") {
    part([x, feet + 1.7, 0], [0.13, 0.38, 0.2], coiffure);
  } else if (hairstyle === "short") {
    part([x, feet + 1.59, 0], [0.38, 0.1, 0.34], coiffure);
  } else {
    part([x - 0.1, feet + 1.69, 0], [0.18, 0.3, 0.2], coiffure);
    part([x + 0.1, feet + 1.66, 0], [0.16, 0.24, 0.2], coiffure);
    part([x, feet + 1.78, 0], [0.15, 0.24, 0.2], coiffure);
  }
  if (transformed) {
    const aura = rgb("#ffc64a");
    part([x - 0.4, feet + 1.05, -0.05], [0.08, 1.45, 0.08], aura);
    part([x + 0.4, feet + 1.05, -0.05], [0.08, 1.45, 0.08], aura);
  }
}

function geometryFor(game, avatar, remotePlayers) {
  const vertices = [];
  cube(vertices, [0, -0.18, 0], [12, 0.36, 4], rgb("#55758b"));
  for (let index = -4; index <= 4; index++)
    cube(vertices, [index * 1.25, -0.015, -1.95], [0.12, 0.02, 0.08], rgb("#99cada"));
  const player = game.player;
  const px = (player.x - 480) / 95;
  const py = Math.max(0, (320 - player.y) / 100);
  addFighter(
    vertices,
    px,
    py,
    avatar.outfit,
    avatar.skin,
    avatar.hair,
    avatar.race,
    avatar.hairstyle,
    player.transformed > 0,
    avatar.build,
    avatar.height,
  );
  for (const enemy of game.enemies) {
    const x = (enemy.x - 480) / 95;
    const y = Math.max(0, (320 - enemy.y) / 100);
    addFighter(vertices, x, y, "#fc8b9c", "#f1c39d", "#442b52");
  }
  for (const remote of remotePlayers) {
    const x = (remote.x - 480) / 95;
    const y = Math.max(0, (320 - remote.y) / 100);
    addFighter(
      vertices,
      x,
      y,
      remote.avatar.outfit,
      remote.avatar.skin,
      remote.avatar.hair,
      remote.avatar.race,
      remote.avatar.hairstyle,
      false,
      remote.avatar.build,
      remote.avatar.height,
    );
  }
  for (const shot of game.shots) {
    const x = (shot.x - 480) / 95;
    const y = Math.max(0.1, (320 - shot.y) / 100);
    cube(vertices, [x, y, 0.24], [0.28, 0.18, 0.18], rgb("#77f3ff"));
  }
  return new Float32Array(vertices);
}

export async function createWebGpuArena(canvas) {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  const module = device.createShaderModule({ code: shader });
  const compilation = await module.getCompilationInfo();
  if (compilation.messages.some((message) => message.type === "error")) return null;
  context.configure({ device, format, alphaMode: "opaque" });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vertex_main",
      buffers: [
        {
          arrayStride: 36,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x3" },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: "fragment_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });
  const uniform = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  });
  const vertex = device.createBuffer({
    size: 262_144,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  let depthTexture;
  const resize = (entry) => {
    const devicePixels = entry?.devicePixelContentBoxSize?.[0];
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(devicePixels?.inlineSize || canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(devicePixels?.blockSize || canvas.clientHeight * ratio));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    depthTexture?.destroy();
    depthTexture = device.createTexture({
      size: [width, height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  };
  const observer = new ResizeObserver(([entry]) => resize(entry));
  observer.observe(canvas);
  resize();
  device.lost.then(() => {
    observer.disconnect();
    depthTexture?.destroy();
    return true;
  });
  return {
    lost: device.lost,
    render(game, avatar, remotePlayers = []) {
      const data = geometryFor(game, avatar, remotePlayers);
      if (data.byteLength > vertex.size) return;
      device.queue.writeBuffer(vertex, 0, data);
      device.queue.writeBuffer(uniform, 0, cameraMatrix(canvas.width / canvas.height));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.06, g: 0.09, b: 0.18, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertex);
      pass.draw(data.length / 9);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}
