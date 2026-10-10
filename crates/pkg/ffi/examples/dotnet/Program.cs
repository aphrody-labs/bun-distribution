// SPDX-License-Identifier: Apache-2.0
using System;
using System.Text;
using Aphrody.Pkg;
using var store = new PackageStore(args[0]);
var digest = store.Put(Encoding.UTF8.GetBytes("ffi-package"));
store.Verify(digest);
Console.WriteLine(digest);
