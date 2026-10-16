// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { Python as NativePython } from "bun:python";
import { Python, PythonError, PyStatus } from "../src/python";

test.skipIf(
  !process.env.BUN_PYTHON_HOST_LIBRARY || !process.env.BUN_PYTHON_LIBPYTHON,
)("the SDK shares Bun's native Python host, errors and disposal", () => {
  expect(Python).toBe(NativePython);
  const python = Python.open();
  try {
    python.run("import os\ndef sdk_echo(value):\n    return value\n");
    expect(python.eval("os.getpid()")).toBe(String(process.pid));
    expect(python.call("__main__", "sdk_echo", "été 🐍")).toBe("été 🐍");
    try {
      python.run("raise ValueError('sdk-fixture')");
      throw new Error("Python exception was hidden");
    } catch (error) {
      expect(error).toBeInstanceOf(PythonError);
      expect((error as PythonError).status).toBe(PyStatus.Python);
    }
    expect(python.eval("2 + 2")).toBe("4");
  } finally {
    python.close();
  }
  expect(() => python.close()).not.toThrow();
  expect(() => python.eval("1")).toThrow("Python host handle is closed");
});
