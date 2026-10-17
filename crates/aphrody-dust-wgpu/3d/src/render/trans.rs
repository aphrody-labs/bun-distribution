use super::{
    AttrsCode, COMMON_VERT_ATTRIBS, CommonCode, EdgeMarkingCode, FogCode, PRIMITIVE_STATE,
    TEXTURE_VERT_ATTRIBS, TRANS_BLENDING, TextureCode, ToonCode, WBufferCode, get_output_color,
};
use crate::render_3d::{BgLayouts, PipelineKey, Vertex};
use core::mem;

pub(super) fn shader_module_src(
    pipeline: PipelineKey,
    fog_enabled_bg_index: u32,
    id_bg_index: u32,
    texture_bg_index: u32,
    toon_bg_index: u32,
) -> [String; 2] {
    let CommonCode {
        common_vert_inputs,
        common_vert_outputs,
        common_set_vert_outputs,
        common_frag_inputs,
        common_frag_outputs,
    } = CommonCode::new();

    let WBufferCode {
        w_buffer_vert_outputs,
        w_buffer_set_vert_outputs,
        w_buffer_frag_inputs,
        w_buffer_frag_outputs,
        w_buffer_set_frag_outputs,
    } = ifdef!(pipeline.w_buffering(), WBufferCode::new());

    let TextureCode {
        texture_uniforms,
        texture_vert_inputs,
        texture_vert_outputs,
        texture_set_vert_outputs,
        texture_frag_inputs,
        texture_get_color,
    } = ifdef!(
        pipeline.texture_mapping_enabled(),
        TextureCode::new(texture_bg_index)
    );

    let ToonCode {
        toon_uniforms,
        toon_get_color,
    } = ifdef!(pipeline.mode() >= 2, ToonCode::new(toon_bg_index));

    let AttrsCode {
        attrs_frag_outputs,
        attrs_init_frag_outputs,
    } = ifdef!(pipeline.attrs_enabled(), AttrsCode::new());

    let FogCode {
        fog_uniforms,
        fog_set_frag_outputs,
    } = ifdef!(pipeline.fog_enabled(), FogCode::new(fog_enabled_bg_index));

    let get_output_color = get_output_color(pipeline.mode(), pipeline.texture_mapping_enabled());

    [
        (
            "if output.color.a < 30.5 / 31.0 { discard; }",
            ifdef!(
                pipeline.edge_marking_enabled(),
                EdgeMarkingCode::new(id_bg_index)
            ),
        ),
        (
            "if (output.color.a < alpha_and_ref.alpha_ref) || (output.color.a >= 30.5 / 31.0) { \
             discard; }",
            Default::default(),
        ),
    ]
    .map(
        |(
            alpha_test,
            EdgeMarkingCode {
                edge_marking_uniforms,
                edge_marking_set_frag_outputs,
            },
        )| {
            format!(
                "
struct AlphaAndRefUniform {{
    alpha: f32,
    alpha_ref: f32,
}};

@group(0) @binding(0) var<uniform> alpha_and_ref: AlphaAndRefUniform;

{texture_uniforms}
{toon_uniforms}
{fog_uniforms}
{edge_marking_uniforms}

struct VertOutput {{
    {common_vert_outputs}
    {w_buffer_vert_outputs}
    {texture_vert_outputs}
}}

@vertex
fn vs_main(
    {common_vert_inputs}
    {texture_vert_inputs}
) -> VertOutput {{
    var output: VertOutput;
    {common_set_vert_outputs}
    {w_buffer_set_vert_outputs}
    {texture_set_vert_outputs}
    output.v_color.a = alpha_and_ref.alpha;
    return output;
}}

struct FragOutput {{
    {common_frag_outputs}
    {w_buffer_frag_outputs}
    {attrs_frag_outputs}
}}

@fragment
fn fs_main(
    {common_frag_inputs}
    {w_buffer_frag_inputs}
    {texture_frag_inputs}
) -> FragOutput {{
    var output: FragOutput;
    {texture_get_color}
    {toon_get_color}
    {get_output_color}
    {alpha_test}
    {w_buffer_set_frag_outputs}
    {attrs_init_frag_outputs}
    {fog_set_frag_outputs}
    {edge_marking_set_frag_outputs}
    return output;
}}"
            )
        },
    )
}

pub(crate) fn create_pipeline(
    pipeline: PipelineKey,
    update_depth: bool,
    device: &crate::wgpu::Device,
    bg_layouts: &BgLayouts,
) -> [crate::wgpu::RenderPipeline; 2] {
    let mut bg_layouts_opaque = vec![&bg_layouts.alpha_and_ref];

    let fog_enabled_bg_index = bg_layouts_opaque.len() as u32;
    if pipeline.fog_enabled() {
        bg_layouts_opaque.push(&bg_layouts.fog_enabled);
    }

    let texture_bg_index = bg_layouts_opaque.len() as u32;
    if pipeline.texture_mapping_enabled() {
        bg_layouts_opaque.push(&bg_layouts.texture);
    }

    let toon_bg_index = bg_layouts_opaque.len() as u32;
    if pipeline.mode() >= 2 {
        bg_layouts_opaque.push(&bg_layouts.toon);
    }

    let bg_layouts_trans = bg_layouts_opaque.clone();

    let id_bg_index = bg_layouts_opaque.len() as u32;
    if pipeline.edge_marking_enabled() {
        bg_layouts_opaque.push(&bg_layouts.id);
    }

    let opaque_layout = device.create_pipeline_layout(&crate::wgpu::PipelineLayoutDescriptor {
        label: Some("3D renderer translucent opaque pass pipeline layout"),
        bind_group_layouts: &bg_layouts_opaque
            .iter()
            .copied()
            .map(Some)
            .collect::<Vec<_>>(),
        immediate_size: 0,
    });

    let trans_layout = device.create_pipeline_layout(&crate::wgpu::PipelineLayoutDescriptor {
        label: Some("3D renderer translucent translucent pass pipeline layout"),
        bind_group_layouts: &bg_layouts_trans
            .iter()
            .copied()
            .map(Some)
            .collect::<Vec<_>>(),
        immediate_size: 0,
    });

    let (opaque_shader_module, trans_shader_module) = {
        let [opaque_src, trans_src] = shader_module_src(
            pipeline,
            fog_enabled_bg_index,
            id_bg_index,
            texture_bg_index,
            toon_bg_index,
        );
        (
            device.create_shader_module(crate::wgpu::ShaderModuleDescriptor {
                label: Some("3D renderer translucent opaque pass shader module"),
                source: crate::wgpu::ShaderSource::Wgsl(opaque_src.into()),
            }),
            device.create_shader_module(crate::wgpu::ShaderModuleDescriptor {
                label: Some("3D renderer translucent translucent pass shader module"),
                source: crate::wgpu::ShaderSource::Wgsl(trans_src.into()),
            }),
        )
    };

    let mut attribs = COMMON_VERT_ATTRIBS.to_vec();

    if pipeline.texture_mapping_enabled() {
        attribs.extend_from_slice(&TEXTURE_VERT_ATTRIBS);
    }

    let stencil_face_state = crate::wgpu::StencilFaceState {
        compare: crate::wgpu::CompareFunction::NotEqual,
        fail_op: crate::wgpu::StencilOperation::Keep,
        depth_fail_op: crate::wgpu::StencilOperation::Keep,
        pass_op: crate::wgpu::StencilOperation::Replace,
    };

    let opaque_desc = crate::wgpu::RenderPipelineDescriptor {
        label: Some("3D renderer translucent pipeline opaque pass"),
        layout: Some(&opaque_layout),

        vertex: crate::wgpu::VertexState {
            module: &opaque_shader_module,
            entry_point: None,
            buffers: &[Some(crate::wgpu::VertexBufferLayout {
                array_stride: mem::size_of::<Vertex>() as u64,
                step_mode: crate::wgpu::VertexStepMode::Vertex,
                attributes: &attribs,
            })],
            compilation_options: Default::default(),
        },

        primitive: PRIMITIVE_STATE,

        depth_stencil: Some(crate::wgpu::DepthStencilState {
            format: crate::wgpu::TextureFormat::Depth24PlusStencil8,
            depth_write_enabled: Some(true),
            depth_compare: Some(if pipeline.depth_test_equal() {
                crate::wgpu::CompareFunction::Equal
            } else {
                crate::wgpu::CompareFunction::Less
            }),
            stencil: crate::wgpu::StencilState::default(),
            bias: crate::wgpu::DepthBiasState::default(),
        }),

        multisample: crate::wgpu::MultisampleState::default(),

        fragment: Some(crate::wgpu::FragmentState {
            module: &opaque_shader_module,
            entry_point: None,
            targets: if pipeline.attrs_enabled() {
                &[
                    Some(crate::wgpu::ColorTargetState {
                        format: crate::wgpu::TextureFormat::Rgba8Unorm,
                        blend: None,
                        write_mask: crate::wgpu::ColorWrites::ALL,
                    }),
                    Some(crate::wgpu::ColorTargetState {
                        format: crate::wgpu::TextureFormat::Rgba8Unorm,
                        blend: None,
                        write_mask: crate::wgpu::ColorWrites::ALL,
                    }),
                ]
            } else {
                &[Some(crate::wgpu::ColorTargetState {
                    format: crate::wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: crate::wgpu::ColorWrites::ALL,
                })]
            },
            compilation_options: Default::default(),
        }),

        multiview_mask: None,
        cache: None,
    };

    let mut trans_fragment_targets = vec![Some(crate::wgpu::ColorTargetState {
        format: crate::wgpu::TextureFormat::Rgba8Unorm,
        blend: pipeline.alpha_blending_enabled().then_some(TRANS_BLENDING),
        write_mask: crate::wgpu::ColorWrites::ALL,
    })];
    if pipeline.attrs_enabled() {
        trans_fragment_targets.push(Some(crate::wgpu::ColorTargetState {
            format: crate::wgpu::TextureFormat::Rgba8Unorm,
            blend: pipeline.fog_enabled().then_some(crate::wgpu::BlendState {
                color: crate::wgpu::BlendComponent::REPLACE,
                alpha: crate::wgpu::BlendComponent {
                    src_factor: crate::wgpu::BlendFactor::One,
                    dst_factor: crate::wgpu::BlendFactor::One,
                    operation: crate::wgpu::BlendOperation::Min,
                },
            }),
            write_mask: crate::wgpu::ColorWrites::ALPHA,
        }));
    }

    [
        device.create_render_pipeline(&opaque_desc),
        device.create_render_pipeline(&crate::wgpu::RenderPipelineDescriptor {
            label: Some("3D renderer translucent pipeline translucent pass"),
            layout: Some(&trans_layout),

            vertex: crate::wgpu::VertexState {
                module: &trans_shader_module,
                entry_point: None,
                buffers: &[Some(crate::wgpu::VertexBufferLayout {
                    array_stride: mem::size_of::<Vertex>() as u64,
                    step_mode: crate::wgpu::VertexStepMode::Vertex,
                    attributes: &attribs,
                })],
                compilation_options: Default::default(),
            },

            depth_stencil: Some(crate::wgpu::DepthStencilState {
                format: crate::wgpu::TextureFormat::Depth24PlusStencil8,
                depth_write_enabled: Some(update_depth),
                depth_compare: Some(if pipeline.depth_test_equal() {
                    crate::wgpu::CompareFunction::Equal
                } else {
                    crate::wgpu::CompareFunction::Less
                }),
                stencil: crate::wgpu::StencilState {
                    front: stencil_face_state,
                    back: stencil_face_state,
                    read_mask: 0x7F,
                    write_mask: 0x7F,
                },
                bias: crate::wgpu::DepthBiasState::default(),
            }),

            fragment: Some(crate::wgpu::FragmentState {
                module: &trans_shader_module,
                entry_point: None,
                targets: &trans_fragment_targets,
                compilation_options: Default::default(),
            }),

            ..opaque_desc
        }),
    ]
}
