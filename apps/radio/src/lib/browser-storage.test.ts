import { expect, test } from "bun:test";
import { getBrowserStorage } from "./browser-storage";

test("returns the scope's storage area", () => {
  const storage = {} as Storage;
  expect(getBrowserStorage("sessionStorage", { sessionStorage: storage })).toBe(
    storage
  );
});

test("treats storage the browser blocks as none", () => {
  const scope = Object.defineProperty({}, "localStorage", {
    get: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  expect(getBrowserStorage("localStorage", scope)).toBeUndefined();
});

test("treats a missing area as none", () => {
  expect(getBrowserStorage("localStorage", {})).toBeUndefined();
});
