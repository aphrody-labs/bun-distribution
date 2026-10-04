import "reflect-metadata";
import { mock } from "bun:test";

// ─── Shim canvas pour environnements sans binding natif ─────────────────────
// @napi-rs/canvas fournit Skia directement ; ses optionalDependencies
// installent le binaire prébuilt @napi-rs/canvas-<triple>
// 1.0.9 de la plateforme courante (win32, linux gnu/musl, darwin, arm64…). Le
// rendu réel est couvert par canvas-render.test.ts. Sur une plateforme sans
// binaire publié, on substitue un shim no-op : imports et DI ne crashent plus et
// les smoke tests tournent (canvas-render.test.ts est alors skippé via
// shenronCanvasNativeOk). La détection n'est tentée que là où un binaire existe :
// ailleurs, le loader napi émet une « unhandled error » non capturable qui ferait
// échouer bun:test malgré 0 échec.
const CANVAS_PREBUILT_TARGETS = new Set([
	"win32-x64",
	"win32-arm64",
	"linux-x64",
	"linux-arm64",
	"linux-arm",
	"linux-riscv64",
	"darwin-x64",
	"darwin-arm64",
	"android-arm64",
]);
let canvasNativeOk = false;
// SHENRON_CANVAS_SHIM=1 force le shim (debug / repro CI sur machine au binding OK).
if (
	Bun.env.SHENRON_CANVAS_SHIM !== "1" &&
	CANVAS_PREBUILT_TARGETS.has(`${process.platform}-${process.arch}`)
) {
	try {
		await import("@napi-rs/canvas");
		canvasNativeOk = true;
	} catch {
		canvasNativeOk = false;
	}
}
(globalThis as Record<string, unknown>).shenronCanvasNativeOk = canvasNativeOk;

if (!canvasNativeOk) {
	const noopCtx = new Proxy(
		{},
		{
			get(_target, prop) {
				if (prop === "measureText") return () => ({ width: 0 });
				if (prop === "createLinearGradient" || prop === "createRadialGradient")
					return () => ({ addColorStop() {} });
				if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
				return () => undefined;
			},
		}
	);
	class FakeImage {
		width = 0;
		height = 0;
		src: unknown = null;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
	}
	const fakeCanvas = () => ({
		width: 0,
		height: 0,
		getContext: () => noopCtx,
		toBuffer: () => Buffer.alloc(0),
		encode: async () => Buffer.alloc(0),
		toDataURL: () => "data:image/png;base64,",
	});
	mock.module("@napi-rs/canvas", () => ({
		createCanvas: () => fakeCanvas(),
		loadImage: async () => new FakeImage(),
		Image: FakeImage,
		GlobalFonts: {
			registerFromPath: () => true,
			register: () => true,
			has: () => false,
			get families() {
				return [];
			},
		},
	}));
}
