import { mock } from "bun:test";

// Mock the phase-vocoder bundle import to avoid module resolution issues in tests
// The ?url import is a Vite-specific feature that returns a URL string
// We mock it to return a dummy URL string for testing
mock.module("./bundles/phase-vocoder-bundle.js?url", () => ({
  default: "mock-phase-vocoder-bundle-url",
}));
