<!-- SPDX-License-Identifier: Apache-2.0 -->
# Backend integration archive

This 2026-09-27 proposal described prototype Remote Hosts, SSH, web crawler and terminal
views. Those views were removed from the public UI. Its claims about UI routes and
actions are historical and must not be used as implementation guidance.

The current public surface and backend ownership are defined by the
[GUI contract](../reference/GUI.md). Keep capabilities behind their owning Rust services; a
backend API does not imply a consumer-facing view. See the repository
[layout](../products/README.md) and [GUI contract](../reference/GUI.md).
