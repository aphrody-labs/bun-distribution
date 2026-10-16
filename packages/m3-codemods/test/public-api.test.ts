// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { transformSource } from "../src/index";

test("the consumer API transforms MUI buttons without starting subprocesses", () => {
  const input =
    'import { Button } from "@mui/material"; export default () => <Button variant="contained">Save</Button>;';
  const result = transformSource(input);
  expect(result.source).toContain("@aphrody/m3-react");
  expect(result.source).toContain("MdFilledButton");
  expect(result.source).not.toContain("@mui/material");
  expect(result.diagnostics).toEqual([]);
});
test("the consumer API reports unsupported semantics instead of hiding migration work", () => {
  const result = transformSource(
    'import { Button } from "@mui/material"; export default () => <Button sx={{ padding: 4 }}>Save</Button>;',
  );
  expect(result.diagnostics.join(" ")).toContain("sx");
  expect(() => transformSource("", "invalid" as never)).toThrow("unknown migration");
});
