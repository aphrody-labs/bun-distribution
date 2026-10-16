/**
 * AvatarRenderer3d — Renderer 3D interactif WebGPU pour les avatars IEVR.
 *
 * Décode la géométrie G4MD/G4MG via nie-wasm et affiche les cheveux,
 * le visage, et le corps avec un shader WGSL de style toon-shading
 * et des contrôles de caméra orbitaux simples via le drag de souris.
 */

import { g4md_parse_json, g4mg_extract_json } from "./wasm/nie_wasm.js";

// ── Mathématiques de matrices minimales 3D ────────────────────────────────────

export class Mat4 {
  static identity(): Float32Array {
    const m = new Float32Array(16);
    m[0] = 1;
    m[5] = 1;
    m[10] = 1;
    m[15] = 1;
    return m;
  }

  static perspective(fovRad: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1.0 / Math.tan(fovRad / 2.0);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2.0 * far * near) / (near - far);
    m[15] = 0;
    return m;
  }

  static lookAt(
    eye: [number, number, number],
    target: [number, number, number],
    up: [number, number, number],
  ): Float32Array {
    const eyeX = eye[0];
    const eyeY = eye[1];
    const eyeZ = eye[2];
    const targetX = target[0];
    const targetY = target[1];
    const targetZ = target[2];

    const z = normalize([eyeX - targetX, eyeY - targetY, eyeZ - targetZ]);
    const x = normalize(cross(up, z));
    const y = cross(z, x);

    const m = new Float32Array(16);
    m[0] = x[0];
    m[1] = y[0];
    m[2] = z[0];
    m[3] = 0;
    m[4] = x[1];
    m[5] = y[1];
    m[6] = z[1];
    m[7] = 0;
    m[8] = x[2];
    m[9] = y[2];
    m[10] = z[2];
    m[11] = 0;
    m[12] = -dot(x, eye);
    m[13] = -dot(y, eye);
    m[14] = -dot(z, eye);
    m[15] = 1;
    return m;
  }

  static multiply(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const valA = a[i * 4 + k] ?? 0;
          const valB = b[k * 4 + j] ?? 0;
          sum += valA * valB;
        }
        out[i * 4 + j] = sum;
      }
    }
    return out;
  }
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ── Shaders WGSL (Toon shading + Anime style) ────────────────────────────────

const SHADER_SOURCE = `
struct Uniforms {
    mvpMatrix : mat4x4<f32>,
    lightDirection : vec3<f32>,
    ambientColor : vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var textureSampler : sampler;
@group(0) @binding(2) var textureData : texture_2d<f32>;

struct VertexInput {
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
    @location(2) uv : vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position : vec4<f32>,
    @location(0) normal : vec3<f32>,
    @location(1) uv : vec2<f32>,
};

@vertex
fn vs_main(in : VertexInput) -> VertexOutput {
    var out : VertexOutput;
    out.clip_position = uniforms.mvpMatrix * vec4<f32>(in.position, 1.0);
    out.normal = in.normal;
    out.uv = in.uv;
    return out;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(textureData, textureSampler, in.uv);
    
    // Si la texture est transparente, on rejette le pixel
    if (color.a < 0.1) {
        discard;
    }
    
    // Éclairage diffus simple Lambert
    let normal = normalize(in.normal);
    let lightDir = normalize(uniforms.lightDirection);
    let diffuse = max(dot(normal, lightDir), 0.0);
    
    // Toon-shading (liseré net d'ombre)
    var toonDiffuse = 0.5;
    if (diffuse > 0.6) {
        toonDiffuse = 1.0;
    } else if (diffuse > 0.2) {
        toonDiffuse = 0.75;
    }
    
    let finalColor = color.rgb * (uniforms.ambientColor + vec3<f32>(toonDiffuse * 0.7));
    return vec4<f32>(finalColor, color.a);
}
`;

// ── Types d'Avatar et de géométrie ───────────────────────────────────────────

export interface GeometryData {
  positions: number[];
  normals: number[];
  uv0: number[];
  indices: number[];
}

export interface AvatarPart {
  id: string;
  kind: "face" | "hair" | "body";
  g4mdBytes: Uint8Array;
  g4mgBytes: Uint8Array;
  textureBitmap?: ImageBitmap;
}

// ── Classe de Rendu Principal ────────────────────────────────────────────────

export class AvatarRenderer3d {
  private canvas: HTMLCanvasElement;
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = "bgra8unorm";

  private pipeline: GPURenderPipeline | null = null;
  private depthTexture: GPUTexture | null = null;
  private depthTextureView: GPUTextureView | null = null;

  // Uniforms
  private uniformBuffer: GPUBuffer | null = null;
  private uniformsBindGroup: GPUBindGroup | null = null;
  private defaultSampler: GPUSampler | null = null;
  private defaultTextureView: GPUTextureView | null = null;

  // Objets de scène compilés
  private renderParts: Array<{
    part: AvatarPart;
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    indexCount: number;
    textureView: GPUTextureView;
    bindGroup: GPUBindGroup;
  }> = [];

  // Caméra et contrôles
  private rotationY = 0;
  private rotationX = 0;
  private cameraDistance = 3.5;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private wasmInitialized = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupMouseEvents();
  }

  /** Initialise WebGPU et le module WASM. */
  async init(): Promise<boolean> {
    this.wasmInitialized = true;

    if (!navigator.gpu) {
      console.error("WebGPU non supporté par ce navigateur.");
      return false;
    }

    this.adapter = await navigator.gpu.requestAdapter();
    if (!this.adapter) {
      console.error("Impossible d'obtenir un GPUAdapter.");
      return false;
    }

    this.device = await this.adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu");
    if (!this.context) {
      console.error("Impossible d'obtenir le contexte WebGPU.");
      return false;
    }

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied",
    });

    await this.buildPipelines();
    return true;
  }

  private async buildPipelines() {
    const device = this.device!;

    const shaderModule = device.createShaderModule({
      code: SHADER_SOURCE,
    });

    // 1. Uniform Buffer
    this.uniformBuffer = device.createBuffer({
      size: 16 * 4 + 4 * 4 + 4 * 4, // MVP (64 bytes) + LightDir (16 bytes) + Ambient (16 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.defaultSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
    });

    // Texture fallback unie (blanche)
    const fallbackTex = device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      this.uniformBuffer,
      64,
      new Float32Array([0.0, 1.0, 1.0, 0.0, 0.3, 0.3, 0.3, 1.0]), // LightDir et Ambient par défaut
    );
    device.queue.writeTexture(
      { texture: fallbackTex },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1, 1],
    );
    this.defaultTextureView = fallbackTex.createView();

    // Pipeline Layout
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
      ],
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 8 * 4, // Pos(3) + Normal(3) + UV(2) = 8 floats
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" }, // Position
              { shaderLocation: 1, offset: 3 * 4, format: "float32x3" }, // Normal
              { shaderLocation: 2, offset: 6 * 4, format: "float32x2" }, // UV0
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "back", // Culling standard
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: "less",
        format: "depth24plus",
      },
    });

    this.recreateDepthTexture();
  }

  private recreateDepthTexture() {
    const device = this.device!;
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = device.createTexture({
      size: [this.canvas.width, this.canvas.height, 1],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTextureView = this.depthTexture.createView();
  }

  /** Redimensionne le canvas de rendu et la texture de profondeur. */
  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.device) {
      this.recreateDepthTexture();
    }
  }

  /** Met à jour la liste des pièces 3D à rendre (tête, cheveux, etc.). */
  async setAvatarParts(parts: AvatarPart[]): Promise<void> {
    if (!this.device) return;
    const device = this.device;

    // Libérer les anciens buffers
    for (const rp of this.renderParts) {
      rp.vertexBuffer.destroy();
      rp.indexBuffer.destroy();
    }
    this.renderParts = [];

    for (const part of parts) {
      try {
        // 1. Décodage G4MD en JSON
        const g4mdJson = g4md_parse_json(part.g4mdBytes);
        // 2. Extraction géométrie G4MG
        const geomJson = g4mg_extract_json(part.g4mgBytes, g4mdJson);
        const geom: GeometryData = JSON.parse(geomJson);

        // 3. Empaqueter les données d'attributs de sommets :
        // Chaque sommet fait 8 floats (pos.x, pos.y, pos.z, norm.x, norm.y, norm.z, u, v)
        const vertexCount = geom.positions.length / 3;
        const vertexData = new Float32Array(vertexCount * 8);
        for (let i = 0; i < vertexCount; i++) {
          const o = i * 8;
          vertexData[o] = geom.positions[i * 3] ?? 0;
          vertexData[o + 1] = geom.positions[i * 3 + 1] ?? 0;
          vertexData[o + 2] = geom.positions[i * 3 + 2] ?? 0;

          vertexData[o + 3] = geom.normals[i * 3] ?? 0;
          vertexData[o + 4] = geom.normals[i * 3 + 1] ?? 0;
          vertexData[o + 5] = geom.normals[i * 3 + 2] ?? 0;

          vertexData[o + 6] = geom.uv0[i * 2] ?? 0;
          vertexData[o + 7] = geom.uv0[i * 2 + 1] ?? 0;
        }

        const vertexBuffer = device.createBuffer({
          size: vertexData.byteLength,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true,
        });
        new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
        vertexBuffer.unmap();

        // Index buffer (U16 ou U32 selon le nombre de sommets)
        const indexData = new Uint16Array(geom.indices);
        const indexBuffer = device.createBuffer({
          size: indexData.byteLength,
          usage: GPUBufferUsage.INDEX,
          mappedAtCreation: true,
        });
        new Uint16Array(indexBuffer.getMappedRange()).set(indexData);
        indexBuffer.unmap();

        // 4. Texture
        let textureView = this.defaultTextureView!;
        if (part.textureBitmap) {
          const tex = device.createTexture({
            size: [part.textureBitmap.width, part.textureBitmap.height, 1],
            format: "rgba8unorm",
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.RENDER_ATTACHMENT,
          });
          device.queue.copyExternalImageToTexture(
            { source: part.textureBitmap },
            { texture: tex },
            [part.textureBitmap.width, part.textureBitmap.height, 1],
          );
          textureView = tex.createView();
        }

        // BindGroup
        const bindGroup = device.createBindGroup({
          layout: this.pipeline!.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer! } },
            { binding: 1, resource: this.defaultSampler! },
            { binding: 2, resource: textureView },
          ],
        });

        this.renderParts.push({
          part,
          vertexBuffer,
          indexBuffer,
          indexCount: geom.indices.length,
          textureView,
          bindGroup,
        });
      } catch (err) {
        console.error(`Erreur d'indexation/compilation 3D de la pièce ${part.id}:`, err);
      }
    }
  }

  /** Rend une frame de la scène 3D. */
  render() {
    if (!this.device || !this.pipeline || !this.context) return;

    const device = this.device;
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const aspect = canvasWidth / canvasHeight;

    // 1. Calculer les matrices de la caméra LookAt
    const targetY = 1.0; // Visage d'avatar typiquement à y=1.0 px
    const eye: [number, number, number] = [
      this.cameraDistance * Math.sin(this.rotationY) * Math.cos(this.rotationX),
      targetY + this.cameraDistance * Math.sin(this.rotationX),
      this.cameraDistance * Math.cos(this.rotationY) * Math.cos(this.rotationX),
    ];
    const target: [number, number, number] = [0, targetY, 0];
    const up: [number, number, number] = [0, 1, 0];

    const viewMatrix = Mat4.lookAt(eye, target, up);
    const projectionMatrix = Mat4.perspective(Math.PI / 4, aspect, 0.1, 100.0);
    const mvpMatrix = Mat4.multiply(projectionMatrix, viewMatrix);

    // 2. Mettre à jour l'uniform buffer
    device.queue.writeBuffer(this.uniformBuffer!, 0, mvpMatrix);

    // 3. Encoder les passes de rendu
    const commandEncoder = device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: view,
          clearValue: { r: 0.15, g: 0.16, b: 0.22, a: 1.0 }, // Couleur de fond premium
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTextureView!,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(this.pipeline);

    for (const rp of this.renderParts) {
      passEncoder.setVertexBuffer(0, rp.vertexBuffer);
      passEncoder.setIndexBuffer(rp.indexBuffer, "uint16");
      passEncoder.setBindGroup(0, rp.bindGroup);
      passEncoder.drawIndexed(rp.indexCount);
    }

    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
  }

  private setupMouseEvents() {
    this.canvas.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;

      this.rotationY += deltaX * 0.007;
      this.rotationX = Math.max(
        -Math.PI / 3,
        Math.min(Math.PI / 3, this.rotationX + deltaY * 0.007),
      );

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.render(); // Force le rendu immédiat à chaque mouvement de souris
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });
  }
}
