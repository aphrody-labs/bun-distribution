// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test";
import { getBeardedIcon, getIcon, getIcon20, getIconByName, iconNames } from "../util";

describe("@aphrody/assets", () => {
  test("kind icons resolve to assets, light variants included", () => {
    expect(String(getIcon("Video", true))).toMatch(/Video\.png$/);
    expect(String(getIcon("Video", false))).toMatch(/Video_Light\.png$/);
    expect(String(getIcon("Unknown", true))).toMatch(/Document\.png$/);
    expect(String(getIcon("Anything", true, null, true))).toMatch(/Folder\.png$/);
  });

  test("20px variants and names", () => {
    expect(String(getIcon20("Video"))).toMatch(/Video-20\.png$/);
    expect(getIcon20("NoSuchKind")).toBeNull();
    expect(iconNames.Video).toBe("Video");
    expect(Object.keys(iconNames).some((n) => n.includes("_"))).toBe(false);
    expect(String(getIconByName("Video", true))).toMatch(/Video\.png$/);
  });

  test("extension badges", () => {
    expect(getBeardedIcon("tsx")).toBe("reactts");
    expect(getBeardedIcon(".WAV")).toBe("audiowav");
    expect(getBeardedIcon(null, "package.json")).toBe("npm");
    expect(getBeardedIcon()).toBeNull();
  });
});
