import { mergeConfig } from "vite";
import appConfig from "./vite.config";

export default mergeConfig(appConfig, {
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});
