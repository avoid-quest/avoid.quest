import { defineConfig } from "bunup";
import pkg from "./package.json";

export default defineConfig({
  name: "cli",
  entry: "src/cli/index.ts",
  compile: {
    outfile: "./out/instarip",
  },
  packages: "bundle",
  minify: true,
  define: {
    PACKAGE_VERSION: JSON.stringify(pkg.version),
  },
});
