import { describe, expect, it } from "bun:test";
import { fastSumSquares } from "../../runtime/src/compute";

describe("YOLO FFI Compute Module (Rust + Bun FFI)", () => {
  it("fastSumSquares calculates correct value for Float64Array", () => {
    const sample = new Float64Array([2.0, 3.0, 4.0]); // 4 + 9 + 16 = 29
    const res = fastSumSquares(sample);
    expect(res).toBe(29);
  });

  it("fastSumSquares handles empty array", () => {
    const empty = new Float64Array([]);
    expect(fastSumSquares(empty)).toBe(0);
  });

  it("fastSumSquares computes large dataset correctly", () => {
    const data = new Float64Array(1000);
    let expected = 0;
    for (let i = 0; i < 1000; i++) {
      data[i] = i % 10;
      expected += (i % 10) * (i % 10);
    }
    expect(fastSumSquares(data)).toBe(expected);
  });
});
