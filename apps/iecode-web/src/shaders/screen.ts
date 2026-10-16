/** Canonical WebGL screen shaders shared by browser and NIE UI consumers. */
export const vertShaderSource =
  "attribute vec2 coords;\n\nvarying vec2 tex_coord;\n\nvoid main() {\n    tex_coord = (vec2(coords.x, -coords.y) + 1.0) * 0.5;\n    gl_Position = vec4(coords.x, coords.y, 0.0, 1.0);\n}\n";
export const fragShaderSource =
  "precision mediump float;\n\nuniform sampler2D framebuffer;\n\nvarying vec2 tex_coord;\n\nvoid main() {\n    gl_FragColor = vec4(texture2D(framebuffer, tex_coord).rgb, 1.0);\n}\n";
