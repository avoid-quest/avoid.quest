import { describe, expect, test } from "bun:test";
import { GrammyError, HttpError } from "grammy";
import { createLogger } from "../infra/logger";
import {
  handleTelegramApiError,
  isRecoverableError,
  logGrammyError,
} from "./error-handler";

// Helper to create GrammyError with proper signature
function createGrammyError(
  errorCode: number | undefined,
  description: string
): GrammyError {
  return new GrammyError(
    description,
    {
      error_code: errorCode,
      description,
      ok: false,
      parameters: {},
    } as any,
    "testMethod",
    {}
  );
}

describe("error-handler", () => {
  describe("logGrammyError", () => {
    test("logs error with context", () => {
      const logger = createLogger(true);
      const error = createGrammyError(400, "Bad Request");

      // Should not throw
      expect(() => logGrammyError(logger, error, "Test context")).not.toThrow();
    });

    test("handles error without error_code", () => {
      const logger = createLogger(true);
      const error = createGrammyError(undefined, "Bad Request");

      expect(() => logGrammyError(logger, error, "Test context")).not.toThrow();
    });
  });

  describe("handleTelegramApiError", () => {
    test("handles 400 error with MEDIA_INVALID", () => {
      const logger = createLogger(true);
      const error = createGrammyError(400, "MEDIA_INVALID");

      expect(() =>
        handleTelegramApiError(error, logger, "Test context")
      ).not.toThrow();
    });

    test("handles 429 rate limit error", () => {
      const logger = createLogger(true);
      const error = createGrammyError(429, "Too Many Requests");

      expect(() =>
        handleTelegramApiError(error, logger, "Test context")
      ).not.toThrow();
    });

    test("handles 403 bot blocked error", () => {
      const logger = createLogger(true);
      const error = createGrammyError(403, "bot was blocked");

      expect(() =>
        handleTelegramApiError(error, logger, "Test context")
      ).not.toThrow();
    });

    test("handles unknown error codes", () => {
      const logger = createLogger(true);
      const error = createGrammyError(999, "Unknown error");

      expect(() =>
        handleTelegramApiError(error, logger, "Test context")
      ).not.toThrow();
    });
  });

  describe("isRecoverableError", () => {
    test("returns true for 429 rate limit error", () => {
      const error = createGrammyError(429, "Too Many Requests");
      expect(isRecoverableError(error)).toBe(true);
    });

    test("returns true for 500-599 server errors", () => {
      const error = createGrammyError(500, "Internal Server Error");
      expect(isRecoverableError(error)).toBe(true);
    });

    test("returns false for 400 client errors", () => {
      const error = createGrammyError(400, "Bad Request");
      expect(isRecoverableError(error)).toBe(false);
    });

    test("returns true for HttpError", () => {
      const error = new HttpError("Network error", 500);
      expect(isRecoverableError(error)).toBe(true);
    });

    test("returns false for unknown errors", () => {
      const error = new Error("Unknown error");
      expect(isRecoverableError(error)).toBe(false);
    });
  });
});
