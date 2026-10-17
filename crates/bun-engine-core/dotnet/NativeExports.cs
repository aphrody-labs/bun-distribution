// SPDX-License-Identifier: GPL-3.0-or-later
// Core transform adapted from pleonex/tinke Plugins/INAZUMA11/Encryption.cs.

using System.Buffers.Binary;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace BunEngine.Nds.Tinke;

public static unsafe class NativeExports
{
    [UnmanagedCallersOnly(EntryPoint = "bun_engine_nds_tinke_abi", CallConvs = [typeof(CallConvCdecl)])]
    public static uint AbiVersion() => 1;

    [UnmanagedCallersOnly(EntryPoint = "bun_engine_nds_tinke_decrypt", CallConvs = [typeof(CallConvCdecl)])]
    public static int Decrypt(byte* data, nuint length, uint blockSize) => Transform(data, length, blockSize, true);

    [UnmanagedCallersOnly(EntryPoint = "bun_engine_nds_tinke_encrypt", CallConvs = [typeof(CallConvCdecl)])]
    public static int Encrypt(byte* data, nuint length, uint blockSize) => Transform(data, length, blockSize, false);

    [UnmanagedCallersOnly(EntryPoint = "bun_engine_nds_tinke_pac_count", CallConvs = [typeof(CallConvCdecl)])]
    public static int PacCount(byte* data, nuint length)
    {
        if (data is null || length < 8) return -1;
        var span = new ReadOnlySpan<byte>(data, checked((int)length));
        uint count = BinaryPrimitives.ReadUInt32LittleEndian(span);
        ulong header = 8UL + 8UL * count;
        return header <= (ulong)length && count <= int.MaxValue ? (int)count : -2;
    }

    private static int Transform(byte* data, nuint length, uint blockSize, bool decrypt)
    {
        if (data is null || blockSize == 0 || length > int.MaxValue) return -1;
        var bytes = new Span<byte>(data, (int)length);
        int block = checked((int)blockSize);
        for (int offset = 0; offset + block <= bytes.Length; offset += block)
        {
            var slice = bytes.Slice(offset, block);
            if (decrypt) DecryptBlock(slice); else EncryptBlock(slice);
        }
        return 0;
    }

    private static void DecryptBlock(Span<byte> data)
    {
        for (int i = 0; i < data.Length; i++) data[i] ^= 0xAD;
        for (int i = 0; i < data.Length; i++) data[i] = RotateRight(data[i], 2);
        SwapStride(data, 3);
        SwapStride(data, 5);
        SwapStride(data, 7);
        SwapStride(data, 2);
    }

    private static void EncryptBlock(Span<byte> data)
    {
        SwapStride(data, 2);
        SwapStride(data, 7);
        SwapStride(data, 5);
        SwapStride(data, 3);
        for (int i = 0; i < data.Length; i++) data[i] = RotateLeft(data[i], 2);
        for (int i = 0; i < data.Length; i++) data[i] ^= 0xAD;
    }

    private static void SwapStride(Span<byte> data, int stride)
    {
        for (int i = 0; i + stride - 1 < data.Length; i += stride)
            (data[i], data[i + stride - 1]) = (data[i + stride - 1], data[i]);
    }

    private static byte RotateLeft(byte value, int count) => (byte)((value << count) | (value >> (8 - count)));
    private static byte RotateRight(byte value, int count) => (byte)((value >> count) | (value << (8 - count)));
}
