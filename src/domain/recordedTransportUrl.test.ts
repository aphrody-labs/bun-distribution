import { expect, it } from "../../tests/support/bunTest.js";

import { parseRecordedTransportUrl } from "./recordedTransportUrl.js";

it("recognizes an empty userinfo marker at the authority start", () => {
  expect(parseRecordedTransportUrl("https://@host")).toMatchObject({
    origin: "https://host",
    path: "/",
    credentials: { start: 8, end: 9 },
  });
});
