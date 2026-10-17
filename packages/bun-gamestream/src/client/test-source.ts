/**
 * Local test source (`?source=test`, or automatically when the server has no sender): an
 * animated 1280x720 canvas captured as a MediaStreamTrack, so the WebGPU/FSR presentation and
 * input capture can be qualified in a browser without the streaming host.
 */
export interface TestSource {
  track: MediaStreamTrack;
  stream: MediaStream;
  /** Last input received, drawn into the pattern so injection is visible on screen. */
  note(text: string): void;
}

export function createTestSource(width = 1280, height = 720, fps = 60): TestSource {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  let lastInput = "no input yet";
  let pointer = { x: width / 2, y: height / 2 };

  const draw = (now: number) => {
    const t = now / 1000;
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, width, height);
    // Fine detail stresses the upscaler: 1 px lines, text and diagonal edges.
    ctx.strokeStyle = "#2e3440";
    ctx.lineWidth = 1;
    for (let x = 0.5; x < width; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0.5; y < height; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(t);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.fillStyle = `hsl(${i * 30} 70% 55%)`;
      ctx.fillRect(60, -8, 140, 16);
    }
    ctx.restore();
    ctx.fillStyle = "#eceff4";
    ctx.font = "28px sans-serif";
    ctx.fillText(`Bun OS gamestream test source  ${width}x${height}  t=${t.toFixed(2)}s`, 24, 48);
    ctx.font = "14px monospace";
    ctx.fillText(`input: ${lastInput}`, 24, height - 24);
    ctx.fillStyle = "#ebcb8b";
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 6, 0, Math.PI * 2);
    ctx.fill();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack;
  return {
    track,
    stream,
    note(text: string) {
      lastInput = text;
      const match = /^ma ([\d.]+) ([\d.]+)/.exec(text);
      if (match) pointer = { x: Number(match[1]) * width, y: Number(match[2]) * height };
      const rel = /^mm (-?\d+) (-?\d+)/.exec(text);
      if (rel) {
        pointer = {
          x: Math.min(width, Math.max(0, pointer.x + Number(rel[1]))),
          y: Math.min(height, Math.max(0, pointer.y + Number(rel[2]))),
        };
      }
    },
  };
}
