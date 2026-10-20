// SPDX-License-Identifier: Apache-2.0
//! Strict SPIR-V to WGSL shader-module translation shared by Bun OS GPU consumers.
//!
//! The supported execution models are Vulkan vertex, fragment and compute
//! stages (SPIR-V models 0, 4 and 5). Translation validates the SPIR-V module
//! and the resulting Naga IR against the baseline capabilities before emitting
//! WGSL. This is a shader compiler boundary only: it does not implement Vulkan
//! resources, synchronization, command buffers, presentation or an ICD.

use std::fmt;

const SPIRV_MAGIC: u32 = 0x0723_0203;
const OP_ENTRY_POINT: u16 = 15;

/// SPIR-V execution models mapped to WebGPU's baseline shader stages.
///
/// Values are from SPIR-V `ExecutionModel`: Vertex, Fragment, and GLCompute.
/// Geometry, tessellation, ray-tracing, kernel, task, mesh, and unknown stages
/// are rejected until a concrete WebGPU implementation and qualification path
/// exists for them.
pub const SUPPORTED_EXECUTION_MODELS: &[u32] = &[0, 4, 5];

/// Machine-readable category for a failed conversion.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShaderTranslationErrorCode {
    /// Header or module framing is invalid.
    InvalidSpirv,
    /// An instruction has an invalid or truncated word count.
    MalformedSpirv,
    /// The module requests an execution model outside WebGPU's baseline stages.
    UnsupportedExecutionModel,
    /// Naga could not parse the SPIR-V module.
    SpirvParse,
    /// Naga validation rejected the parsed shader module.
    Validation,
    /// Naga could not express the validated module as WGSL.
    WgslGeneration,
}

impl ShaderTranslationErrorCode {
    /// Stable lowercase code for host APIs and diagnostics.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidSpirv => "invalid_spirv",
            Self::MalformedSpirv => "malformed_spirv",
            Self::UnsupportedExecutionModel => "unsupported_execution_model",
            Self::SpirvParse => "spirv_parse_failed",
            Self::Validation => "naga_validation_failed",
            Self::WgslGeneration => "wgsl_generation_failed",
        }
    }
}

/// Structured failure from the shader conversion boundary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShaderTranslationError {
    /// Stable machine-readable error category.
    pub code: ShaderTranslationErrorCode,
    /// Diagnostic suitable for logs and UI; it is not a compatibility claim.
    pub message: String,
    /// SPIR-V execution model when the failure is stage-related.
    pub execution_model: Option<u32>,
    /// Word offset when the failure is caused by malformed module framing.
    pub word_offset: Option<usize>,
}

impl ShaderTranslationError {
    fn new(code: ShaderTranslationErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            execution_model: None,
            word_offset: None,
        }
    }

    fn at_word(mut self, word_offset: usize) -> Self {
        self.word_offset = Some(word_offset);
        self
    }
}

impl fmt::Display for ShaderTranslationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for ShaderTranslationError {}

/// Translate one SPIR-V module into WGSL, rejecting unsupported stages and
/// modules that fail Naga parsing, validation, or WGSL generation.
///
/// The resulting WGSL must still be passed to the target WebGPU implementation
/// for its own `GPUShaderModule` validation. Success here does not establish
/// that a pipeline layout, device feature set, or Vulkan command stream works.
pub fn translate_spirv_to_wgsl(words: &[u32]) -> Result<String, ShaderTranslationError> {
    validate_module_framing(words)?;
    validate_execution_models(words)?;

    let options = naga::front::spv::Options::default();
    let module = naga::front::spv::Frontend::new(words.iter().copied(), &options)
        .parse()
        .map_err(|error| {
            ShaderTranslationError::new(
                ShaderTranslationErrorCode::SpirvParse,
                format!("Naga SPIR-V parser rejected the module: {error:?}"),
            )
        })?;

    let info = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::default(),
    )
    .validate(&module)
    .map_err(|error| {
        ShaderTranslationError::new(
            ShaderTranslationErrorCode::Validation,
            format!("Naga validation rejected the module: {error:?}"),
        )
    })?;

    naga::back::wgsl::write_string(
        &module,
        &info,
        naga::back::wgsl::WriterFlags::EXPLICIT_TYPES,
    )
    .map_err(|error| {
        ShaderTranslationError::new(
            ShaderTranslationErrorCode::WgslGeneration,
            format!("Naga WGSL writer rejected the module: {error:?}"),
        )
    })
}

fn validate_module_framing(words: &[u32]) -> Result<(), ShaderTranslationError> {
    if words.len() < 5 || words[0] != SPIRV_MAGIC || words[4] != 0 {
        return Err(ShaderTranslationError::new(
            ShaderTranslationErrorCode::InvalidSpirv,
            "expected a SPIR-V header with the standard magic, five header words, and schema zero",
        ));
    }

    let mut offset = 5usize;
    while offset < words.len() {
        let instruction = words[offset];
        let word_count = (instruction >> 16) as usize;
        let opcode = instruction as u16;
        if word_count == 0 || offset.saturating_add(word_count) > words.len() {
            return Err(ShaderTranslationError::new(
                ShaderTranslationErrorCode::MalformedSpirv,
                format!("instruction at word {offset} has invalid word count {word_count}"),
            )
            .at_word(offset));
        }
        if opcode == OP_ENTRY_POINT && word_count < 4 {
            return Err(ShaderTranslationError::new(
                ShaderTranslationErrorCode::MalformedSpirv,
                format!("OpEntryPoint at word {offset} is missing its name or function id"),
            )
            .at_word(offset));
        }
        offset += word_count;
    }
    Ok(())
}

fn validate_execution_models(words: &[u32]) -> Result<(), ShaderTranslationError> {
    let mut offset = 5usize;
    while offset < words.len() {
        let instruction = words[offset];
        let word_count = (instruction >> 16) as usize;
        if instruction as u16 == OP_ENTRY_POINT {
            let model = words[offset + 1];
            if !SUPPORTED_EXECUTION_MODELS.contains(&model) {
                let mut error = ShaderTranslationError::new(
                    ShaderTranslationErrorCode::UnsupportedExecutionModel,
                    format!(
                        "SPIR-V execution model {model} is not supported; WebGPU baseline accepts vertex (0), fragment (4), and compute (5)"
                    ),
                );
                error.execution_model = Some(model);
                error.word_offset = Some(offset);
                return Err(error);
            }
        }
        offset += word_count;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ShaderTranslationErrorCode as Code, translate_spirv_to_wgsl};

    // Minimal SPIR-V 1.0 vertex shader writing a constant to BuiltIn Position.
    // It deliberately avoids descriptors and extensions so this test isolates
    // the parser, validator, and WGSL writer contract.
    const VERTEX: &[u32] = &[
        0x0723_0203,
        0x0001_0000,
        0,
        12,
        0,
        0x0002_0011,
        1, // OpCapability Shader
        0x0003_000e,
        0,
        1, // OpMemoryModel Logical GLSL450
        0x0006_000f,
        0,
        7,
        0x6e69_616d,
        0,
        4, // OpEntryPoint Vertex %7 "main" %4 (NUL-terminated name)
        0x0004_0047,
        4,
        11,
        0, // OpDecorate %4 BuiltIn Position
        0x0002_0013,
        1, // OpTypeVoid %1
        0x0003_0021,
        2,
        1, // OpTypeFunction %2 %1
        0x0003_0016,
        3,
        32, // OpTypeFloat %3 32
        0x0004_0017,
        5,
        3,
        4, // OpTypeVector %5 %3 4
        0x0004_0020,
        6,
        3,
        5, // OpTypePointer %6 Output %5
        0x0004_003b,
        6,
        4,
        3, // OpVariable %6 %4 Output
        0x0004_002b,
        3,
        9,
        0, // OpConstant %3 %9 0.0
        0x0004_002b,
        3,
        10,
        0x3f80_0000, // OpConstant %3 %10 1.0
        0x0005_0036,
        1,
        7,
        0,
        2, // OpFunction %1 %7 None %2
        0x0002_00f8,
        8, // OpLabel %8
        0x0007_0050,
        5,
        11,
        9,
        9,
        9,
        10, // OpCompositeConstruct %5 %11 ...
        0x0003_003e,
        4,
        11,          // OpStore %4 %11
        0x0001_00fd, // OpReturn
        0x0001_0038, // OpFunctionEnd
    ];

    #[test]
    fn translates_valid_vertex_shader_to_wgsl() {
        let wgsl = translate_spirv_to_wgsl(VERTEX).expect("valid shader translates");
        assert!(
            wgsl.contains("@vertex"),
            "expected vertex entry point: {wgsl}"
        );
        assert!(
            wgsl.contains("@builtin(position)"),
            "expected position output: {wgsl}"
        );
    }

    #[test]
    fn rejects_geometry_execution_model_before_translation() {
        let mut words = VERTEX.to_vec();
        words[11] = 3;
        let error = translate_spirv_to_wgsl(&words).expect_err("geometry stage is unsupported");
        assert_eq!(error.code, Code::UnsupportedExecutionModel);
        assert_eq!(error.execution_model, Some(3));
        assert_eq!(error.word_offset, Some(10));
    }

    #[test]
    fn rejects_bad_magic_as_structured_failure() {
        let mut words = VERTEX.to_vec();
        words[0] = 0;
        let error = translate_spirv_to_wgsl(&words).expect_err("invalid header is rejected");
        assert_eq!(error.code, Code::InvalidSpirv);
    }

    #[test]
    fn rejects_truncated_instruction_with_word_offset() {
        let mut words = VERTEX.to_vec();
        words.extend_from_slice(&[0x0002_0013]);
        let error = translate_spirv_to_wgsl(&words).expect_err("truncated instruction is rejected");
        assert_eq!(error.code, Code::MalformedSpirv);
        assert_eq!(error.word_offset, Some(VERTEX.len()));
    }
}
