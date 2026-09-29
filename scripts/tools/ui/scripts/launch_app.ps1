# SPDX-License-Identifier: Apache-2.0
# Launch Aphrody Desktop App directly on the user's interactive desktop (WinSta0\Default)

param(
    [string]$ExePath = (Join-Path $PSScriptRoot "..\target\release\aphrody-app.exe")
)

Add-Type @"
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class DesktopLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    public static int LaunchOnDefaultDesktop(string exePath, string workingDir) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.lpDesktop = @"WinSta0\Default";
        si.dwFlags = 1; // STARTF_USESHOWWINDOW
        si.wShowWindow = 1; // SW_SHOWNORMAL

        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();

        bool success = CreateProcess(
            exePath,
            "\"" + exePath + "\"",
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            0x00000010, // CREATE_NEW_CONSOLE
            IntPtr.Zero,
            workingDir,
            ref si,
            out pi
        );

        if (!success) {
            int err = Marshal.GetLastWin32Error();
            throw new Win32Exception(err, "Failed to CreateProcess: " + new Win32Exception(err).Message);
        }

        int pid = pi.dwProcessId;
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return pid;
    }
}
"@

Write-Host "Stopping existing instances..."
Stop-Process -Name aphrody-app, msedgewebview2 -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

Write-Host "Launching $ExePath on WinSta0\Default..."
$workingDir = Split-Path -Parent $ExePath
$appPid = [DesktopLauncher]::LaunchOnDefaultDesktop($ExePath, $workingDir)
Write-Host "Launched PID: $appPid"
