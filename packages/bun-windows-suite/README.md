# @aphrody/bun-windows-suite

Opt-in facade for Bun's modern Windows 11 surface. Nothing is activated by importing the package. Select capabilities explicitly with `activate(["windows", "winrt"])` or `BUN_WINDOWS_CAPABILITIES=windows,winrt`.

The minimal runtime boundary is Win32/COM/WinRT ABI, ConPTY, FFI and toolchain discovery. Larger payloads remain optional: the .NET object bridge is `@aphrody/bun-dotnet`; PowerShell, Roslyn, Windows Terminal, vcpkg and Fluent UI retain their independent source histories under `vendor/` and build as separate artifacts.

This package is an activation and distribution boundary. It does not claim that the current Bun executable has already removed every Windows builtin from its binary. Binary extraction is qualified separately with size and behavior measurements.

`triageWindowsFinding()` optionally sends one structured finding to TypeSafe Jev for area, impact and review-needed classification. It reads `TYPESAFE_API_KEY` only at call time, pins `jev-1.13.0`, and never authorizes a build, Git operation or other side effect.
