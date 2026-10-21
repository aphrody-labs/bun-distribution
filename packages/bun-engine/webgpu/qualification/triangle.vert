#version 450
layout(location = 0) out vec2 uv;
void main() {
    const vec2 positions[3] = vec2[3](
        vec2(-0.8, -0.8), vec2(0.8, -0.8), vec2(0.0, 0.8)
    );
    uv = positions[gl_VertexIndex];
    gl_Position = vec4(positions[gl_VertexIndex], 0.0, 1.0);
}
