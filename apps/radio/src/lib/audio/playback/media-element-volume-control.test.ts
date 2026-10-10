import { afterEach, expect, test } from "bun:test";
import { isMediaVolumeLocked } from "./media-element-volume-control.js";

const originals = {
  CSS: Object.getOwnPropertyDescriptor(globalThis, "CSS"),
  document: Object.getOwnPropertyDescriptor(globalThis, "document"),
};

function installBrowser(selectorSupported: boolean, locked: boolean): void {
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: {
      supports: (condition: string) =>
        selectorSupported && condition === "selector(:volume-locked)",
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        matches: (selector: string) => {
          if (!selectorSupported) {
            throw new SyntaxError(`'${selector}' is not a valid selector`);
          }
          return selector === ":volume-locked" && locked;
        },
      }),
    },
  });
}

afterEach(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("media volume is not locked outside a browser", () => {
  Reflect.deleteProperty(globalThis, "CSS");
  Reflect.deleteProperty(globalThis, "document");
  expect(isMediaVolumeLocked()).toBe(false);
});

test.each([
  [true, true, true],
  [true, false, false],
  [false, true, false],
] as const)(
  ":volume-locked supported=%p matches=%p reports locked=%p",
  (selectorSupported, locked, expected) => {
    installBrowser(selectorSupported, locked);
    expect(isMediaVolumeLocked()).toBe(expected);
  }
);
