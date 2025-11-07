import { describe, test, expect, mock } from "bun:test";
import { GrammyError, HttpError } from "grammy";
import { logGrammyError, handleTelegramApiError, isRecoverableError } from "./error-handler";
import { createLogger } from "../infra/logger";

describe("error-handler", () => {
  describe("logGrammyError", () => {
    test("logs error with context", () => {
      const logger = createLogger(true);
      const error = new GrammyError("Test error", {
        error_code: 400,
        description: "Bad Request",
        ok: false,
        parameters: {},
      } as any);

      // Should not throw
      expect(() => logGrammyError(logger, error, "Test context")).not.toThrow();
    });

    test("handles error without error_code", () => {
      const logger = createLogger(true);
      const error = new GrammyError("Test error", {
        description: "Bad Request",
        ok: false,
        parameters: {},
      } as any);

      expect(() => logGrammyError(logger, error, "Test context")).not.toThrow();
    });
  });

  describe("handleTelegramApiError", () => {
    test("handles 400 error with MEDIA_INVALID", () => {
      const logger = createLogger(true);
      const error = new GrammyError("Test error", {
        error_code: 400,
        description: "MEDIA_INVALID",
        ok: false,
        parameters: {},
      } as any);

      expect(() => handleTelegramApiError(error, logger, "Test context")).not.toThrow();
    });

    test("handles 429 rate limit error", () => {
      const logger = createLogger(true);
      const error = new GrammyError("Test error", {
        error_code: 429,
        description: "Too Many Requests",
        ok: false,
        parameters: {},
      } as any);

      expect(() => handleTelegramApiError(error, logger, "Test context")).not.toThrow();
    });

    test("handles 403 bot blocked error", () => {
      const logger = createLogger(true);
      const error = new GrammyError("Test error", {
        error_code: 403,
        description: "bot was blocked",
        ok: false,
        parameters: {},
      } as any);

      expect(() => handleTelegramApiError(error, logger, "Test context")).not.toThrow();
    });

    test("handles unknown error codes", () => {
      const logger = createLogger(true);
      const error = new GrammyError("Test error", {
        error_code: 999,
        description: "Unknown error",
        ok: false,
        parameters: {},
      } as any);

      expect(() => handleTelegramApiError(error, logger, "Test context")).not.toThrow();
    });
  });

  describe("isRecoverableError", () => {
    test("returns true for 429 rate limit error", () => {
      const error = new GrammyError("Test error", {
        error_code: 429,
        description: "Too Many Requests",
        ok: false,
        parameters: {},
      } as any);

      expect(isRecoverableError(error)).toBe(true);
    });

    test("returns true for 500-599 server errors", () => {
      const error = new GrammyError("Test error", {
        error_code: 500,
        description: "Internal Server Error",
        ok: false,
        parameters: {},
      } as any);

      expect(isRecoverableError(error)).toBe(true);
    });

    test("returns false for 400 client errors", () => {
      const error = new GrammyError("Test error", {
        error_code: 400,
        description: "Bad Request",
        ok: false,
        parameters: {},
      } as any);

      expect(isRecoverableError(error)).toBe(false);
    });

    test("returns true for HttpError", () => {
      const error = new HttpError("Network error");
      expect(isRecoverableError(error)).toBe(true);
    });

    test("returns false for unknown errors", () => {
      const error = new Error("Unknown error");
      expect(isRecoverableError(error)).toBe(false);
    });
  });
});

