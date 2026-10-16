// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { render } from "./nginx-gen.ts";

test("the gateway serves every live rosegriffon.fr route with its catalog upstream", () => {
  const conf = render();
  for (const host of [
    "rosegriffon.fr",
    "api.rosegriffon.fr",
    "cdn.rosegriffon.fr",
    "achillea.rosegriffon.fr",
    "ranked.rosegriffon.fr",
    "azalee.rosegriffon.fr",
  ])
    expect(conf).toContain(`/etc/letsencrypt/live/${host}/fullchain.pem`);
  expect(conf).toContain("proxy_pass http://127.0.0.1:3004;");
  expect(conf).toContain("proxy_pass http://127.0.0.1:4002;");
  expect(conf).toContain("server_name rosegriffon.fr www.rosegriffon.fr;");
  expect(conf).not.toContain("nie.aphrody.com");
});
