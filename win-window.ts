import { dlopen, FFIType, ptr, JSCallback } from "bun:ffi";

/**
 * Fenêtre Windows native 100% Bun (Zero dépendance npm).
 * Utilise exclusivement `bun:ffi` et les bibliothèques système de System32 :
 * - kernel32.dll
 * - user32.dll
 * - gdi32.dll
 */

// ---------------------------------------------------------------------------
// 1. Chargement des DLL Windows système (System32)
// ---------------------------------------------------------------------------

const kernel32 = dlopen("kernel32.dll", {
  GetModuleHandleW: { args: [FFIType.ptr], returns: FFIType.ptr },
  GetLastError: { args: [], returns: FFIType.u32 },
});

const user32 = dlopen("user32.dll", {
  RegisterClassExW: { args: [FFIType.ptr], returns: FFIType.u16 },
  CreateWindowExW: {
    args: [
      FFIType.u32, // dwExStyle
      FFIType.ptr, // lpClassName (LPCWSTR)
      FFIType.ptr, // lpWindowName (LPCWSTR)
      FFIType.u32, // dwStyle
      FFIType.i32, // X
      FFIType.i32, // Y
      FFIType.i32, // nWidth
      FFIType.i32, // nHeight
      FFIType.ptr, // hWndParent
      FFIType.ptr, // hMenu
      FFIType.ptr, // hInstance
      FFIType.ptr, // lpParam
    ],
    returns: FFIType.ptr,
  },
  ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool },
  UpdateWindow: { args: [FFIType.ptr], returns: FFIType.bool },
  DestroyWindow: { args: [FFIType.ptr], returns: FFIType.bool },
  DefWindowProcW: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.i64,
  },
  GetMessageW: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.i32,
  },
  TranslateMessage: { args: [FFIType.ptr], returns: FFIType.bool },
  DispatchMessageW: { args: [FFIType.ptr], returns: FFIType.i64 },
  PostQuitMessage: { args: [FFIType.i32], returns: FFIType.void },
  LoadCursorW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  GetClientRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
  BeginPaint: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  EndPaint: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
  DrawTextW: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  SetTimer: {
    args: [FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.ptr],
    returns: FFIType.u64,
  },
});

const gdi32 = dlopen("gdi32.dll", {
  SetBkMode: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  SetTextColor: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
});

// ---------------------------------------------------------------------------
// 2. Constantes Win32
// ---------------------------------------------------------------------------

const CS_VREDRAW = 0x0001;
const CS_HREDRAW = 0x0002;
const IDC_ARROW = 32512;
const COLOR_WINDOW = 5;

// Window Styles
const WS_OVERLAPPED = 0x00000000;
const WS_CAPTION = 0x00c00000;
const WS_SYSMENU = 0x00080000;
const WS_THICKFRAME = 0x00040000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_OVERLAPPEDWINDOW =
  WS_OVERLAPPED |
  WS_CAPTION |
  WS_SYSMENU |
  WS_THICKFRAME |
  WS_MINIMIZEBOX |
  WS_MAXIMIZEBOX;
const CW_USEDEFAULT = -2147483648; // 0x80000000 as signed i32

// Messages
const WM_DESTROY = 0x0002;
const WM_PAINT = 0x000f;
const WM_KEYDOWN = 0x0100;
const WM_TIMER = 0x0113;
const VK_ESCAPE = 0x1b;

// ShowWindow
const SW_SHOW = 5;

// DrawText flags
const DT_CENTER = 0x00000001;
const DT_VCENTER = 0x00000004;
const DT_WORDBREAK = 0x00000010;

// GDI Background Mode
const TRANSPARENT = 1;

// ---------------------------------------------------------------------------
// 3. Utilitaires d'encodage UTF-16LE pour Win32 LPCWSTR
// ---------------------------------------------------------------------------

function toUtf16LE(str: string): Buffer {
  const buf = Buffer.alloc((str.length + 1) * 2);
  buf.write(str, "utf16le");
  buf.writeUInt16LE(0, str.length * 2); // Null terminator \0
  return buf;
}

// ---------------------------------------------------------------------------
// 4. Configuration et arguments CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let autoCloseTimeoutMs = 0;
let windowWidth = 680;
let windowHeight = 440;
let windowTitle = "Bun Native Win32 Window (System32 + FFI)";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--timeout" && args[i + 1]) {
    autoCloseTimeoutMs = Number.parseInt(args[++i], 10);
  } else if (args[i] === "--width" && args[i + 1]) {
    windowWidth = Number.parseInt(args[++i], 10);
  } else if (args[i] === "--height" && args[i + 1]) {
    windowHeight = Number.parseInt(args[++i], 10);
  } else if (args[i] === "--title" && args[i + 1]) {
    windowTitle = args[++i];
  }
}

const classNameStr = "BunNaiveWin32WindowClass";
const classNameBuf = toUtf16LE(classNameStr);
const classNamePtr = ptr(classNameBuf);

const windowTitleBuf = toUtf16LE(windowTitle);
const windowTitlePtr = ptr(windowTitleBuf);

const contentText =
  `✨ Fenêtre Win32 Native propulsée par Bun (bun:ffi)\n\n` +
  `• Moteur : Bun ${Bun.version} (vitesse maximale, zéro wrapper)\n` +
  `• Dépendances npm : 0 (aucune)\n` +
  `• Couche : System32 (user32.dll, kernel32.dll, gdi32.dll)\n` +
  `• Architecture : x64 (WNDCLASSEXW, GetMessageW, DispatchMessageW)\n\n` +
  `Appuyez sur Échap ou fermez la fenêtre pour quitter.`;
const contentTextBuf = toUtf16LE(contentText);
const contentTextPtr = ptr(contentTextBuf);

// ---------------------------------------------------------------------------
// 5. Callback de boucle d'événements Win32 (WNDPROC)
// ---------------------------------------------------------------------------

// Buffers pré-alloués pour les événements fréquents
const paintStruct = Buffer.alloc(128); // PAINTSTRUCT x64
const paintStructPtr = ptr(paintStruct);

const clientRect = Buffer.alloc(16); // RECT (left, top, right, bottom: 4 x i32)
const clientRectPtr = ptr(clientRect);

const wndProc = new JSCallback(
  (hwnd: number, msg: number, wParam: bigint, lParam: bigint): bigint => {
    switch (msg) {
      case WM_PAINT: {
        const hdc = user32.symbols.BeginPaint(hwnd, paintStructPtr);
        if (hdc) {
          user32.symbols.GetClientRect(hwnd, clientRectPtr);

          // Rendu du texte en noir avec fond transparent
          gdi32.symbols.SetBkMode(hdc, TRANSPARENT);
          gdi32.symbols.SetTextColor(hdc, 0x00111111);

          // Décalage pour marge intérieure
          clientRect.writeInt32LE(clientRect.readInt32LE(0) + 40, 0); // left
          clientRect.writeInt32LE(clientRect.readInt32LE(4) + 40, 4); // top
          clientRect.writeInt32LE(clientRect.readInt32LE(8) - 40, 8); // right
          clientRect.writeInt32LE(clientRect.readInt32LE(12) - 40, 12); // bottom

          user32.symbols.DrawTextW(
            hdc,
            contentTextPtr,
            -1,
            clientRectPtr,
            DT_WORDBREAK
          );

          user32.symbols.EndPaint(hwnd, paintStructPtr);
        }
        return 0n;
      }

      case WM_KEYDOWN: {
        if (Number(wParam) === VK_ESCAPE) {
          user32.symbols.DestroyWindow(hwnd);
          return 0n;
        }
        break;
      }

      case WM_TIMER: {
        user32.symbols.DestroyWindow(hwnd);
        return 0n;
      }

      case WM_DESTROY: {
        user32.symbols.PostQuitMessage(0);
        return 0n;
      }
    }

    return user32.symbols.DefWindowProcW(hwnd, msg, wParam, lParam);
  },
  {
    args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.i64,
  }
);

// ---------------------------------------------------------------------------
// 6. Enregistrement de la classe de fenêtre (WNDCLASSEXW - 80 octets sur x64)
// ---------------------------------------------------------------------------

const hInstance = kernel32.symbols.GetModuleHandleW(0);
const hCursor = user32.symbols.LoadCursorW(0, IDC_ARROW);

const wndClass = Buffer.alloc(80);
wndClass.writeUInt32LE(80, 0); // cbSize = sizeof(WNDCLASSEXW)
wndClass.writeUInt32LE(CS_HREDRAW | CS_VREDRAW, 4); // style
wndClass.writeBigUInt64LE(BigInt(wndProc.ptr), 8); // lpfnWndProc
wndClass.writeInt32LE(0, 16); // cbClsExtra
wndClass.writeInt32LE(0, 20); // cbWndExtra
wndClass.writeBigUInt64LE(BigInt(hInstance), 24); // hInstance
wndClass.writeBigUInt64LE(0n, 32); // hIcon
wndClass.writeBigUInt64LE(BigInt(hCursor), 40); // hCursor
wndClass.writeBigUInt64LE(BigInt(COLOR_WINDOW + 1), 48); // hbrBackground (fond blanc classique)
wndClass.writeBigUInt64LE(0n, 56); // lpszMenuName
wndClass.writeBigUInt64LE(BigInt(classNamePtr), 64); // lpszClassName
wndClass.writeBigUInt64LE(0n, 72); // hIconSm

const classAtom = user32.symbols.RegisterClassExW(ptr(wndClass));
if (!classAtom) {
  const err = kernel32.symbols.GetLastError();
  console.error(`[Erreur] Échec de RegisterClassExW (code: ${err})`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 7. Création de la fenêtre (CreateWindowExW)
// ---------------------------------------------------------------------------

const hwnd = user32.symbols.CreateWindowExW(
  0, // dwExStyle
  classNamePtr, // lpClassName
  windowTitlePtr, // lpWindowName
  WS_OVERLAPPEDWINDOW, // dwStyle
  CW_USEDEFAULT, // X
  CW_USEDEFAULT, // Y
  windowWidth, // nWidth
  windowHeight, // nHeight
  0, // hWndParent
  0, // hMenu
  hInstance, // hInstance
  0 // lpParam
);

if (!hwnd) {
  const err = kernel32.symbols.GetLastError();
  console.error(`[Erreur] Échec de CreateWindowExW (code: ${err})`);
  process.exit(1);
}

// Affichage et rafraîchissement
user32.symbols.ShowWindow(hwnd, SW_SHOW);
user32.symbols.UpdateWindow(hwnd);

if (autoCloseTimeoutMs > 0) {
  user32.symbols.SetTimer(hwnd, 1n, autoCloseTimeoutMs, 0);
}

console.log(`[Bun Win32] Fenêtre créée avec succès !`);
console.log(` - HWND      : 0x${hwnd.toString(16)}`);
console.log(` - Titre     : "${windowTitle}"`);
console.log(` - Taille    : ${windowWidth}x${windowHeight}`);
if (autoCloseTimeoutMs > 0) {
  console.log(` - Minuteur  : fermeture automatique dans ${autoCloseTimeoutMs}ms`);
}
console.log(`[Bun Win32] Boucle de messages démarrée...`);

// ---------------------------------------------------------------------------
// 8. Boucle de messages native (GetMessageW / TranslateMessage / DispatchMessageW)
// ---------------------------------------------------------------------------

const msgBuf = Buffer.alloc(48); // sizeof(MSG) sur x64 = 48 octets
const msgBufPtr = ptr(msgBuf);

while (user32.symbols.GetMessageW(msgBufPtr, 0, 0, 0) > 0) {
  user32.symbols.TranslateMessage(msgBufPtr);
  user32.symbols.DispatchMessageW(msgBufPtr);
}

console.log(`[Bun Win32] Fenêtre fermée. Processus terminé avec succès.`);
