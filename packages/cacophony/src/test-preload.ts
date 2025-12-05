import { mock } from "bun:test";

// Mock the phase-vocoder bundle import to avoid module resolution issues in tests
// The ?url import is a Vite-specific feature that returns a URL string
// We mock it to return a dummy URL string for testing
const projectRoot = process.cwd();

mock.module("./bundles/phase-vocoder-bundle.js?url", () => ({
  default: "mock-phase-vocoder-bundle-url",
}));
mock.module(`${projectRoot}/packages/cacophony/src/bundles/cacophony-processor-bundle.js?url`, () => ({
  default: "mock-cacophony-processor-bundle-url",
}));
mock.module("./bundles/cacophony-processor-bundle.js?url", () => ({
  default: "mock-cacophony-processor-bundle-url",
}));
