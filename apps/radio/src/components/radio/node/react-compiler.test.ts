import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import type { LoggerEvent } from "babel-plugin-react-compiler";

/**
 * The React Compiler skips a function it cannot lower and leaves it
 * unmemoized without failing the build. The canvas relies on compiled
 * handlers staying stable (React Flow pushes every changed handler prop into
 * its store), so a silent bailout here costs a store update per prop per
 * frame. This runs the preset vite.config.ts hands to
 * @rolldown/plugin-babel, through that plugin's own @babel/core.
 */
const babel = createRequire(import.meta.resolve("@rolldown/plugin-babel"))(
  "@babel/core"
) as {
  transformSync: (code: string, options: Record<string, unknown>) => unknown;
};

const TEST_FILE = /\.test\.tsx?$/;
const nodeDir = import.meta.dir;
const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(nodeDir)]
  .filter((file) => !TEST_FILE.test(file))
  .sort();

/** Each function in `file` the compiler gave up on, with its reason. */
function compileErrors(file: string): string[] {
  const errors: string[] = [];
  const logEvent = (_filename: string | null, event: LoggerEvent) => {
    if (event.kind === "CompileError") {
      errors.push(`${file}:${event.fnLoc?.start.line}: ${event.detail.reason}`);
    } else if (event.kind === "PipelineError") {
      errors.push(`${file}:${event.fnLoc?.start.line}: ${event.data}`);
    }
  };
  babel.transformSync(readFileSync(path.join(nodeDir, file), "utf8"), {
    babelrc: false,
    configFile: false,
    filename: file,
    parserOpts: {
      plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
      sourceType: "module",
    },
    presets: [reactCompilerPreset({ logger: { logEvent } }).preset],
  });
  return errors;
}

describe("React Compiler", () => {
  test("finds the node components", () => {
    expect(files).toContain("node-canvas.tsx");
  });

  test.each(files)("compiles every function in %s", (file) => {
    expect(compileErrors(file)).toEqual([]);
  });
});
