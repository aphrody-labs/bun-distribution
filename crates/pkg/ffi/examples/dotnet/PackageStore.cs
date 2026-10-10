// SPDX-License-Identifier: Apache-2.0
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace Aphrody.Pkg;
public sealed class PackageStore : IDisposable {
    const string Library = "aphrody_pkg";
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] static extern uint aphrody_pkg_abi_version();
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] static extern int aphrody_pkg_store_open(byte[] root, nuint length, out ulong handle);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] static extern int aphrody_pkg_store_put(ulong store, byte[] data, nuint length, IntPtr expected, nuint expectedLength, out ulong result);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] static extern int aphrody_pkg_buffer_copy(ulong result, [Out] byte[] data, nuint capacity);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] static extern int aphrody_pkg_store_verify(ulong store, byte[] digest, nuint length);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] static extern int aphrody_pkg_release(ulong handle);
    ulong handle;
    static void Check(int status) { if(status != 0) throw new InvalidOperationException($"package ABI status {status}"); }
    public PackageStore(string root) {
        if(aphrody_pkg_abi_version() != 1) throw new InvalidOperationException("unsupported package ABI");
        var bytes=Encoding.UTF8.GetBytes(root); Check(aphrody_pkg_store_open(bytes,(nuint)bytes.Length,out handle));
    }
    void Live() { if(handle == 0) throw new ObjectDisposedException(nameof(PackageStore)); }
    public string Put(byte[] bytes) {
        Live(); Check(aphrody_pkg_store_put(handle,bytes,(nuint)bytes.Length,IntPtr.Zero,0,out var result));
        try { var digest=new byte[64]; Check(aphrody_pkg_buffer_copy(result,digest,64)); return Encoding.ASCII.GetString(digest); }
        finally { Check(aphrody_pkg_release(result)); }
    }
    public void Verify(string digest) { Live(); var bytes=Encoding.ASCII.GetBytes(digest); Check(aphrody_pkg_store_verify(handle,bytes,(nuint)bytes.Length)); }
    public void Dispose() { if(handle!=0) { Check(aphrody_pkg_release(handle)); handle=0; } }
}
