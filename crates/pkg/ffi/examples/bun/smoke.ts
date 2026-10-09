// SPDX-License-Identifier: Apache-2.0
import { openPackageStore } from "./index";
const store = openPackageStore(process.argv[2]!, process.argv[3]!);
try {
  const digest = store.put(new TextEncoder().encode("ffi-package"));
  store.verify(digest);
  console.log(digest, store.stats());
} finally {
  store.close();
}
