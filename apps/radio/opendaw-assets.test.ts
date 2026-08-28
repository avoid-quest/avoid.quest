import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { rewriteOpenDawEngineWorklet } from "./opendaw-assets";

const UPSTREAM_URL = 'new URL("@opendaw/nam-wasm/nam.wasm", import.meta.url)';
const moduleRequire = createRequire(import.meta.url);

describe("rewriteOpenDawEngineWorklet", () => {
  test("rewrites exactly one upstream NAM asset URL", () => {
    expect(rewriteOpenDawEngineWorklet(`const url = ${UPSTREAM_URL};`)).toBe(
      'const url = new URL("/opendaw/nam.wasm", globalThis.location.origin);'
    );
  });

  test("rejects missing or ambiguous upstream code", () => {
    expect(() => rewriteOpenDawEngineWorklet("const url = 'changed';")).toThrow(
      "Expected exactly one openDAW NAM asset URL"
    );
    expect(() =>
      rewriteOpenDawEngineWorklet(`${UPSTREAM_URL}; ${UPSTREAM_URL};`)
    ).toThrow("Expected exactly one openDAW NAM asset URL");
  });

  test("matches the installed openDAW worklet artifact", () => {
    const coreEntry = moduleRequire.resolve("@opendaw/studio-core");
    const worklet = readFileSync(
      path.join(path.dirname(coreEntry), "EngineWorklet.js"),
      "utf8"
    );

    expect(rewriteOpenDawEngineWorklet(worklet)).toContain(
      'new URL("/opendaw/nam.wasm", globalThis.location.origin)'
    );
  });
});
