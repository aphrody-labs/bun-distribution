<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/web-to-tauri

Converts a website, web app or built bundle into a native Tauri 3 app that changes nothing the
page, its API or its backend can see. Guide:
[`docs/guides/ui/WEB-TO-TAURI.md`](../../docs/guides/WEB-TO-TAURI.md). Config contract:
[`docs/apis/ui/WRAP-CONFIG.md`](../../docs/apis/WRAP-CONFIG.md). Runtime:
[`crates/ui/tauri-wrap`](../../../crates/ui/tauri-wrap).

```sh
yolo m3 web-to-tauri plan https://example.com          # npm bin: web-to-tauri plan ...
yolo m3 web-to-tauri convert https://example.com --out ../example-app
```
