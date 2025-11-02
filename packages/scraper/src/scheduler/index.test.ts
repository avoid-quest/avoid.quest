import { test, expect, describe, beforeEach, afterEach, mock, jest } from "bun:test";
import type { EffectiveSettings } from "../settings";

// Mock the dependencies - these will be set up in beforeEach
let mockGetEffectiveSettings: ReturnType<typeof mock<() => EffectiveSettings>>;
let mockScrapeOnce: ReturnType<typeof mock<() => Promise<void>>>;
let mockRunTelegramOnce: ReturnType<typeof mock<() => Promise<void>>>;

// Mock Cron class
class MockCron {
  pattern: string;
  callback?: () => void | Promise<void>;
  nextRunDate: Date | null;
  private _isRunning: boolean;
  private _isStopped: boolean;

  constructor(pattern: string, callback?: () => void | Promise<void>) {
    this.pattern = pattern;
    this.callback = callback;
    this.nextRunDate = this.calculateNextRun();
    this._isRunning = true;
    this._isStopped = false;
  }

  private calculateNextRun(): Date {
    // Simple calculation: next run in 1 hour from now
    const next = new Date();
    next.setHours(next.getHours() + 1);
    next.setMinutes(0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  nextRun(): Date | null {
    if (this._isStopped) return null;
    return this.nextRunDate;
  }

  stop(): void {
    this._isRunning = false;
    this._isStopped = true;
    this.nextRunDate = null;
  }
}

// Set up mocks before importing the module
mock.module("croner", () => {
  return {
    Cron: MockCron,
  };
});

mock.module("../settings", () => {
  return {
    getEffectiveSettings: async (): Promise<EffectiveSettings> => {
      return mockGetEffectiveSettings();
    },
  };
});

mock.module("../scraping/scraper", () => {
  return {
    scrapeOnce: async () => {
      await mockScrapeOnce();
    },
  };
});

mock.module("../telegram", () => {
  return {
    runTelegramOnce: async () => {
      await mockRunTelegramOnce();
    },
  };
});

// Import after mocks are set up
import {
  startScheduler,
  stopScheduler,
  getScraperNextRun,
  getTelegramNextRun,
  getSchedulerStatus,
} from "./index";

describe("Scheduler", () => {
  beforeEach(() => {
    // Reset all mocks
    mockGetEffectiveSettings = mock(() => ({
      scraper: {
        active: false,
        cron_expression: undefined,
        limit: 5,
        last_scraped_at: undefined,
      },
      telegram: {
        active: false,
        admin_chat_id: undefined,
        group_chat_id: undefined,
        cron_expression: undefined,
        send_limit: 3,
        last_sent_at: undefined,
        send_report: false,
        report_cron_expression: undefined,
      },
      logging: {
        active: false,
        last_logged_at: undefined,
        max_retention_days: undefined,
        log_file: undefined,
        log_level: undefined,
      },
    }));

    mockScrapeOnce = mock((): Promise<void> => Promise.resolve());
    mockRunTelegramOnce = mock((): Promise<void> => Promise.resolve());

    // Reset scheduler state
    stopScheduler();

    // Set fake timers
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
    stopScheduler();
  });

  describe("startScheduler", () => {
    test("creates scraper cron job with valid cron expression", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: "0 * * * *",
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: false,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();

      const status = getSchedulerStatus();
      expect(status.scraper.active).toBe(true);
      expect(status.scraper.cronExpression).toBe("0 * * * *");
      expect(status.scraper.nextRun).toBeInstanceOf(Date);
    });

    test("creates telegram cron job with valid cron expression", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: false,
          cron_expression: undefined,
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: true,
          admin_chat_id: "123",
          group_chat_id: undefined,
          cron_expression: "0 9 * * *",
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();

      const status = getSchedulerStatus();
      expect(status.telegram.active).toBe(true);
      expect(status.telegram.cronExpression).toBe("0 9 * * *");
      expect(status.telegram.nextRun).toBeInstanceOf(Date);
    });

    test("creates both cron jobs when both are active", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: "0 * * * *",
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: true,
          admin_chat_id: "123",
          group_chat_id: undefined,
          cron_expression: "0 9 * * *",
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();

      const status = getSchedulerStatus();
      expect(status.scraper.active).toBe(true);
      expect(status.telegram.active).toBe(true);
    });

    test("does not create cron jobs when settings are inactive", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: false,
          cron_expression: undefined,
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: false,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();

      const status = getSchedulerStatus();
      expect(status.scraper.active).toBe(false);
      expect(status.telegram.active).toBe(false);
    });

    test("does not create scraper job when active but no cron expression", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: undefined,
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: false,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();

      const status = getSchedulerStatus();
      expect(status.scraper.active).toBe(false);
    });

    test("handles invalid cron expression gracefully", async () => {
      // Mock Cron to throw error on invalid pattern
      class ThrowingMockCron {
        constructor(pattern: string, callback?: () => void | Promise<void>) {
          if (pattern === "invalid-cron-expression") {
            throw new Error("Invalid cron expression");
          }
          // For other patterns, behave like MockCron
          // But since we're throwing, this won't be reached
        }
        nextRun(): Date | null {
          return null;
        }
        stop(): void {
          // no-op
        }
      }

      // Replace mock temporarily
      mock.module("croner", () => {
        return {
          Cron: ThrowingMockCron,
        };
      });

      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: "invalid-cron-expression",
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: false,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      // Should not throw, but handle error gracefully
      await startScheduler();

      const status = getSchedulerStatus();
      // Should handle error gracefully and not create job
      expect(status.scraper.active).toBe(false);

      // Restore original mock for other tests
      mock.module("croner", () => {
        return {
          Cron: MockCron,
        };
      });
    });

    test("replaces existing cron jobs when starting again", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: "0 * * * *",
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: false,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();
      const firstStatus = getSchedulerStatus();
      const firstNextRun = firstStatus.scraper.nextRun;

      // Update to new cron expression
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: "30 * * * *",
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: false,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();
      const secondStatus = getSchedulerStatus();

      expect(secondStatus.scraper.active).toBe(true);
      expect(secondStatus.scraper.cronExpression).toBe("30 * * * *");
    });
  });

  describe("stopScheduler", () => {
    test("stops all cron jobs and clears state", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: "0 * * * *",
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: true,
          admin_chat_id: "123",
          group_chat_id: undefined,
          cron_expression: "0 9 * * *",
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();
      expect(getSchedulerStatus().scraper.active).toBe(true);
      expect(getSchedulerStatus().telegram.active).toBe(true);

      stopScheduler();

      const status = getSchedulerStatus();
      expect(status.scraper.active).toBe(false);
      expect(status.telegram.active).toBe(false);
      expect(status.scraper.cronExpression).toBeUndefined();
      expect(status.telegram.cronExpression).toBeUndefined();
    });
  });

  describe("getScraperNextRun", () => {
    test("returns next run date when scraper cron is active", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: "0 * * * *",
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: false,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();
      const nextRun = getScraperNextRun();

      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun).not.toBeNull();
    });

    test("returns null when scraper cron is not active", () => {
      stopScheduler();
      const nextRun = getScraperNextRun();

      expect(nextRun).toBeNull();
    });
  });

  describe("getTelegramNextRun", () => {
    test("returns next run date when telegram cron is active", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: false,
          cron_expression: undefined,
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: true,
          admin_chat_id: "123",
          group_chat_id: undefined,
          cron_expression: "0 9 * * *",
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();
      const nextRun = getTelegramNextRun();

      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun).not.toBeNull();
    });

    test("returns null when telegram cron is not active", () => {
      stopScheduler();
      const nextRun = getTelegramNextRun();

      expect(nextRun).toBeNull();
    });
  });

  describe("getSchedulerStatus", () => {
    test("returns correct status for active scraper", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: true,
          cron_expression: "0 * * * *",
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: false,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();
      const status = getSchedulerStatus();

      expect(status.scraper.active).toBe(true);
      expect(status.scraper.cronExpression).toBe("0 * * * *");
      expect(status.scraper.nextRun).toBeInstanceOf(Date);
      expect(status.telegram.active).toBe(false);
    });

    test("returns correct status for active telegram", async () => {
      mockGetEffectiveSettings = mock(() => ({
        scraper: {
          active: false,
          cron_expression: undefined,
          limit: 5,
          last_scraped_at: undefined,
        },
        telegram: {
          active: true,
          admin_chat_id: "123",
          group_chat_id: undefined,
          cron_expression: "0 9 * * *",
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await startScheduler();
      const status = getSchedulerStatus();

      expect(status.telegram.active).toBe(true);
      expect(status.telegram.cronExpression).toBe("0 9 * * *");
      expect(status.telegram.nextRun).toBeInstanceOf(Date);
      expect(status.scraper.active).toBe(false);
    });

    test("returns correct status when both are inactive", () => {
      stopScheduler();
      const status = getSchedulerStatus();

      expect(status.scraper.active).toBe(false);
      expect(status.scraper.nextRun).toBeNull();
      expect(status.scraper.cronExpression).toBeUndefined();
      expect(status.telegram.active).toBe(false);
      expect(status.telegram.nextRun).toBeNull();
      expect(status.telegram.cronExpression).toBeUndefined();
    });
  });
});

