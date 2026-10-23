/** Browser-facing SPIR-V shader bridge used by the WebX WebGPU adapter. */

/** wasm-bindgen export from aphrody-gpu-backend's optional `vkwebgpu` feature. */
export interface SpirvWasmBinding {
  spirv_to_wgsl(words: Uint32Array): string;
}

export type WebXShaderFailureCode =
  | "invalid_spirv_input"
  | "spirv_translation_failed"
  | "empty_wgsl"
  | "webgpu_error_scope_failed"
  | "webgpu_shader_creation_failed"
  | "wgsl_compilation_failed";

export interface WebXShaderFailure {
  code: WebXShaderFailureCode;
  message: string;
  diagnostics?: readonly {
    message: string;
    lineNum?: number;
    linePos?: number;
  }[];
  cause?: unknown;
}

export type WebXShaderModuleResult =
  { ok: true; module: GPUShaderModule; wgsl: string } | { ok: false; error: WebXShaderFailure };

export type WebXShaderTranslator = (
  device: GPUDevice,
  words: Uint32Array,
  label?: string,
) => Promise<WebXShaderModuleResult>;

/** Bind the actual wasm export to the WebX plugin's injected translator slot. */
export function createWebXShaderTranslator(binding: SpirvWasmBinding): WebXShaderTranslator {
  return (device, words, label) => createWebXShaderModule(device, binding, words, label);
}

/**
 * Converts SPIR-V with the real Naga-backed wasm export and validates the
 * result in WebGPU before reporting shader-module creation as successful.
 * This establishes shader translation and module validity only; it does not
 * imply Vulkan or DXVK compatibility.
 */
export async function createWebXShaderModule(
  device: GPUDevice,
  translator: SpirvWasmBinding,
  words: Uint32Array,
  label?: string,
): Promise<WebXShaderModuleResult> {
  if (!(words instanceof Uint32Array) || words.length < 5) {
    return {
      ok: false,
      error: {
        code: "invalid_spirv_input",
        message: "SPIR-V input must be a Uint32Array containing a complete module header.",
      },
    };
  }

  let wgsl: string;
  try {
    wgsl = translator.spirv_to_wgsl(words);
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "spirv_translation_failed",
        message: structuredErrorMessage(cause, "SPIR-V to WGSL translation failed."),
        cause,
      },
    };
  }
  if (typeof wgsl !== "string" || wgsl.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "empty_wgsl",
        message: "SPIR-V translator returned no WGSL source.",
      },
    };
  }

  try {
    device.pushErrorScope("validation");
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "webgpu_error_scope_failed",
        message: structuredErrorMessage(cause, "WebGPU validation error scope could not be opened."),
        cause,
      },
    };
  }

  let module: GPUShaderModule;
  try {
    module = device.createShaderModule({ code: wgsl, label });
  } catch (cause) {
    let scopeError: GPUError | null;
    try {
      scopeError = await device.popErrorScope();
    } catch (scopeCause) {
      return {
        ok: false,
        error: {
          code: "webgpu_error_scope_failed",
          message: structuredErrorMessage(scopeCause, "WebGPU validation error scope could not be closed."),
          cause: { creationError: cause, scopeError: scopeCause },
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "webgpu_shader_creation_failed",
        message: scopeError?.message ?? structuredErrorMessage(cause, "WebGPU rejected shader-module creation."),
        cause: scopeError ?? cause,
      },
    };
  }

  const compilation = Promise.resolve().then(() => module.getCompilationInfo());
  const errorScope = Promise.resolve().then(() => device.popErrorScope());
  const [compilationResult, scopeResult] = await Promise.allSettled([compilation, errorScope]);
  if (scopeResult.status === "rejected") {
    return {
      ok: false,
      error: {
        code: "webgpu_error_scope_failed",
        message: structuredErrorMessage(scopeResult.reason, "WebGPU validation error scope could not be closed."),
        cause: scopeResult.reason,
      },
    };
  }
  if (compilationResult.status === "rejected") {
    return {
      ok: false,
      error: {
        code: "webgpu_shader_creation_failed",
        message: structuredErrorMessage(
          compilationResult.reason,
          "WebGPU shader compilation information could not be read.",
        ),
        cause: compilationResult.reason,
      },
    };
  }

  const info = compilationResult.value;
  const scopeError = scopeResult.value;

  const diagnostics = info.messages
    .filter(message => message.type === "error")
    .map(({ message, lineNum, linePos }) => ({ message, lineNum, linePos }));
  if (scopeError || diagnostics.length > 0) {
    return {
      ok: false,
      error: {
        code: "wgsl_compilation_failed",
        message: scopeError?.message ?? diagnostics.map(item => item.message).join("\n"),
        diagnostics,
        cause: scopeError ?? undefined,
      },
    };
  }

  return { ok: true, module, wgsl };
}

function structuredErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return typeof error === "string" && error.length > 0 ? error : fallback;
}
