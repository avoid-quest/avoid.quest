import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import type { Logger } from "../infra/logger";
import type { EffectiveSettings } from "../settings";

// Mock variables
let mockGetEffectiveSettings: ReturnType<typeof mock<() => EffectiveSettings>>;
let mockGetHttpClient: ReturnType<typeof mock<() => any>>;
let mockCreateLogger: ReturnType<
  typeof mock<(enabled: boolean, minLevel?: string) => Logger>
>;
let mockAutoRetry: ReturnType<typeof mock<(config: any) => any>>;
let mockFetch: ReturnType<
  typeof mock<(url: string, init?: any) => Promise<Response>>
>;

// Mock GrammyError and HttpError
class MockGrammyError extends Error {
  error_code?: number;
  description?: string;
  constructor(message: string, error_code?: number, description?: string) {
    super(message);
    this.name = "GrammyError";
    this.error_code = error_code;
    this.description = description;
  }
}

class MockHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpError";
  }
}

// Mock Bot class
class MockBot {
  token: string;
  api: {
    sendMediaGroup: ReturnType<
      typeof mock<(chatId: string, media: any[]) => Promise<void>>
    >;
    sendVideo: ReturnType<
      typeof mock<(chatId: string, url: string, opts?: any) => Promise<void>>
    >;
    sendPhoto: ReturnType<
      typeof mock<(chatId: string, url: string, opts?: any) => Promise<void>>
    >;
    sendMessage: ReturnType<
      typeof mock<(chatId: string, text: string, opts?: any) => Promise<void>>
    >;
    config: {
      use: ReturnType<typeof mock<(plugin: any) => void>>;
    };
  };

  constructor(token: string) {
    this.token = token;
    this.api = {
      sendMediaGroup: mock(async () => {
        // Mock implementation
      }),
      sendVideo: mock(async () => {
        // Mock implementation
      }),
      sendPhoto: mock(async () => {
        // Mock implementation
      }),
      sendMessage: mock(async () => {
        // Mock implementation
      }),
      config: {
        use: mock(() => {
          // Mock implementation
        }),
      },
    };
  }
}

// Store bot instances created during tests
// Use an object to maintain reference across module mock closures
const botRegistry = { bots: [] as MockBot[] };

// Mock InputMediaBuilder
const MockInputMediaBuilder = {
  video: mock((url: string, opts?: any) => ({
    type: "video",
    media: url,
    ...opts,
  })),
  photo: mock((url: string, opts?: any) => ({
    type: "photo",
    media: url,
    ...opts,
  })),
};

// Test data fixtures
function createMockPost(overrides?: Partial<Doc<"posts">>): Doc<"posts"> {
  return {
    _id: "post123" as any,
    _creationTime: Date.now(),
    shortcode: "abc123",
    ig_id: "ig123",
    display_url: "https://example.com/image.jpg",
    video_url: undefined,
    thumbnail_url: undefined,
    caption: "Test caption",
    is_video: false,
    url: "https://instagram.com/p/abc123",
    media_type: "image",
    users: [],
    timestamp: Date.now(),
    sent: false,
    sentAt: undefined,
    event_date: undefined,
    ...overrides,
  };
}

function createMockMediaItem(
  type: "image" | "video",
  url: string,
  overrides?: Partial<any>
): any {
  return {
    _id: `media_${Date.now()}` as any,
    _creationTime: Date.now(),
    url,
    type,
    post_id: "post123" as any,
    width: 1080,
    height: 1080,
    ...overrides,
  };
}

function createMockLogger(): Logger {
  return {
    debug: mock(() => {
      // Mock implementation
    }),
    info: mock(() => {
      // Mock implementation
    }),
    warn: mock(() => {
      // Mock implementation
    }),
    error: mock(() => {
      // Mock implementation
    }),
  };
}

// Set up mocks before importing
mock.module("../settings", () => ({
  getEffectiveSettings: async (): Promise<EffectiveSettings> =>
    mockGetEffectiveSettings(),
}));

mock.module("../infra/logger", () => ({
  createLogger: (enabled: boolean, minLevel?: string): Logger =>
    mockCreateLogger(enabled, minLevel),
}));

mock.module("../convex/client", () => ({
  getHttpClient: () => mockGetHttpClient(),
  api: {
    media_items: {
      getMediaItemsByPostId: "getMediaItemsByPostId",
    },
    posts: {
      getUnsent: "getUnsent",
      markSent: "markSent",
    },
  },
}));

mock.module("grammy", () => ({
  Bot: class extends MockBot {
    constructor(token: string) {
      super(token);
      botRegistry.bots.push(this);
    }
  } as any,
  GrammyError: MockGrammyError,
  HttpError: MockHttpError,
  InputMediaBuilder: MockInputMediaBuilder,
}));

mock.module("@grammyjs/auto-retry", () => ({
  autoRetry: (config: any) => mockAutoRetry(config),
}));

// Mock global fetch - will be assigned in beforeEach
// Import after mocks are set up
import { runTelegramOnce } from "./index";

// Since internal functions are not exported, we'll test them indirectly
// For direct testing, we need to access them differently
// For now, we'll test through runTelegramOnce and create test helpers

describe("Telegram Module", () => {
  let mockLogger: Logger;
  let originalEnvToken: string | undefined;

  beforeEach(() => {
    // Save original env
    originalEnvToken = process.env.TELEGRAM_BOT_TOKEN;

    // Reset bot instances
    botRegistry.bots = [];

    // Create fresh mocks
    mockLogger = createMockLogger();
    mockCreateLogger = mock(() => mockLogger);
    mockGetHttpClient = mock(() => ({
      query: mock(async () => []),
      mutation: mock(async () => "mutation_result"),
    }));
    mockAutoRetry = mock((config: any) => ({ type: "autoRetry", config }));
    mockFetch = mock(
      async (_url: string) =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "image/jpeg" }),
        }) as Response
    );
    // Assign mockFetch to global.fetch after initialization
    global.fetch = mockFetch as unknown as typeof fetch;

    // Default settings
    mockGetEffectiveSettings = mock(() => ({
      telegram: {
        active: true,
        admin_chat_id: "123456",
        group_chat_id: undefined,
        cron_expression: "0 * * * *",
        send_limit: 3,
        last_sent_at: undefined,
        send_report: false,
        report_cron_expression: undefined,
      },
      scraper: {
        active: false,
        cron_expression: undefined,
        limit: 5,
        last_scraped_at: undefined,
      },
      logging: {
        active: true,
        last_logged_at: undefined,
        max_retention_days: undefined,
        log_file: undefined,
        log_level: "debug",
      },
    }));
  });

  afterEach(() => {
    // Restore original env
    if (originalEnvToken !== undefined) {
      process.env.TELEGRAM_BOT_TOKEN = originalEnvToken;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = undefined;
    }
  });

  describe("runTelegramOnce", () => {
    test("returns early when telegram is not active", async () => {
      mockGetEffectiveSettings = mock(() => ({
        telegram: {
          active: false,
          admin_chat_id: "123456",
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        scraper: {
          active: false,
          cron_expression: undefined,
          limit: 5,
          last_scraped_at: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await runTelegramOnce();

      expect(mockGetHttpClient().query).not.toHaveBeenCalled();
    });

    test("returns early when bot token is missing", async () => {
      process.env.TELEGRAM_BOT_TOKEN = undefined;

      await runTelegramOnce();

      expect(mockGetHttpClient().query).not.toHaveBeenCalled();
    });

    test("returns early when chatId is missing", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";
      mockGetEffectiveSettings = mock(() => ({
        telegram: {
          active: true,
          admin_chat_id: undefined,
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        scraper: {
          active: false,
          cron_expression: undefined,
          limit: 5,
          last_scraped_at: undefined,
        },
        logging: {
          active: false,
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      await runTelegramOnce();

      expect(mockGetHttpClient().query).not.toHaveBeenCalled();
    });

    test("fetches unsent posts with correct limit", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";
      const mockQuery = mock(async () => []);
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mock(async () => "mutation_result"),
      }));

      await runTelegramOnce();

      expect(mockQuery).toHaveBeenCalledWith("getUnsent", { limit: 3 });
    });

    test("processes posts successfully and marks them as sent", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
        createMockMediaItem("image", "https://example.com/image2.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      await runTelegramOnce();

      // Get the bot instance that was created
      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      expect(mockQuery).toHaveBeenCalled();
      expect(bot.api.sendMediaGroup).toHaveBeenCalled();
      expect(mockMutation).toHaveBeenCalledWith("markSent", {
        id: post._id,
        sentAt: expect.any(Number),
      });
    });

    test("continues processing other posts when one fails", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post1 = createMockPost({ _id: "post1" as any });
      const post2 = createMockPost({ _id: "post2" as any });
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
        createMockMediaItem("image", "https://example.com/image2.jpg"),
      ];

      let sendCallCount = 0;
      const mockQuery = mock((queryName: string) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post1, post2]);
        }
        if (queryName === "getMediaItemsByPostId") {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      // Create a bot class that fails on first sendMediaGroup call
      class FailingMockBot extends MockBot {
        constructor(token: string) {
          super(token);
          // Replace sendMediaGroup to fail on first call, succeed on second
          const ERROR_CODE_BAD_REQUEST = 400;
          this.api.sendMediaGroup = mock(() => {
            sendCallCount++;
            if (sendCallCount === 1) {
              return Promise.reject(
                new MockGrammyError(
                  "Failed to send",
                  ERROR_CODE_BAD_REQUEST,
                  "Bad Request"
                )
              );
            }
            return Promise.resolve();
          });
          botRegistry.bots.push(this);
        }
      }

      // Temporarily replace Bot class
      mock.module("grammy", () => ({
        Bot: FailingMockBot as any,
        GrammyError: MockGrammyError,
        HttpError: MockHttpError,
        InputMediaBuilder: MockInputMediaBuilder,
      }));

      await runTelegramOnce();

      // Should have tried to send both posts
      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }
      // Error should be logged for failed post
      expect(mockLogger.error).toHaveBeenCalled();
      // At least one mutation should succeed (second post)
      expect(mockMutation).toHaveBeenCalled();
      expect(mockMutation).toHaveBeenCalledWith("markSent", {
        id: post2._id,
        sentAt: expect.any(Number),
      });

      // Restore original Bot mock
      mock.module("grammy", () => ({
        Bot: class extends MockBot {
          constructor(token: string) {
            super(token);
            botRegistry.bots.push(this);
          }
        } as any,
        GrammyError: MockGrammyError,
        HttpError: MockHttpError,
        InputMediaBuilder: MockInputMediaBuilder,
      }));
    });

    test("uses correct logger based on settings", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";
      // Ensure DEBUG is not set
      const originalDebug = process.env.DEBUG;
      process.env.DEBUG = undefined;

      mockGetEffectiveSettings = mock(() => ({
        telegram: {
          active: true,
          admin_chat_id: "123456",
          group_chat_id: undefined,
          cron_expression: undefined,
          send_limit: 3,
          last_sent_at: undefined,
          send_report: false,
          report_cron_expression: undefined,
        },
        scraper: {
          active: false,
          cron_expression: undefined,
          limit: 5,
          last_scraped_at: undefined,
        },
        logging: {
          active: false, // Logging disabled
          last_logged_at: undefined,
          max_retention_days: undefined,
          log_file: undefined,
          log_level: undefined,
        },
      }));

      const mockQuery = mock(async () => []);
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mock(async () => "mutation_result"),
      }));

      await runTelegramOnce();

      // Logger should be created with enabled=false when logging.active is false and DEBUG is not set
      // Check the actual call argument
      const calls = mockCreateLogger.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls.at(-1);
      if (lastCall) {
        expect(lastCall[0]).toBe(false);
      }

      // Restore original DEBUG
      if (originalDebug !== undefined) {
        process.env.DEBUG = originalDebug;
      }
    });

    test("validates media group before sending (too few items)", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      // Only 1 media item (needs at least 2 for media group)
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should not call sendMediaGroup (validation would fail, falls back to other methods)
      // Should try tryPrimaryMedia or trySingleValidMedia instead
      expect(bot.api.sendMediaGroup).not.toHaveBeenCalled();
      // Post should still be processed successfully via fallback
      expect(mockMutation).toHaveBeenCalled();
    });

    test("validates media group before sending (too many items)", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      // 11 media items (exceeds max of 10)
      const mediaItems = Array.from({ length: 11 }, (_, i) =>
        createMockMediaItem("image", `https://example.com/image${i}.jpg`)
      );

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should slice to 10 items and still send
      expect(bot.api.sendMediaGroup).toHaveBeenCalled();
      const mediaGroupCall = bot.api.sendMediaGroup.mock.calls[0];
      expect(mediaGroupCall?.[1]).toHaveLength(10); // Second arg is media array
    });

    test("validates URLs before sending", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
        createMockMediaItem("image", "https://example.com/image2.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      // Mock fetch to return accessible URLs
      mockFetch = mock(
        async (_url: string) =>
          ({
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "image/jpeg" }),
          }) as Response
      );
      // Reassign to global.fetch so the module uses the updated mock
      global.fetch = mockFetch as unknown as typeof fetch;

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should validate URLs via fetch
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("All 2 media URLs are accessible")
      );
      expect(bot.api.sendMediaGroup).toHaveBeenCalled();
    });

    test("logs warning for inaccessible URLs but continues", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
        createMockMediaItem("image", "https://example.com/404.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      // Mock fetch to return 404 for second URL
      let callCount = 0;
      const STATUS_OK = 200;
      const STATUS_NOT_FOUND = 404;
      const SECOND_CALL = 2;
      mockFetch = mock((_url: string) => {
        callCount++;
        return Promise.resolve({
          ok: callCount !== SECOND_CALL,
          status: callCount === SECOND_CALL ? STATUS_NOT_FOUND : STATUS_OK,
          statusText: callCount === SECOND_CALL ? "Not Found" : "OK",
          headers: new Headers(),
        } as Response);
      });
      // Reassign to global.fetch so the module uses the updated mock
      global.fetch = mockFetch as unknown as typeof fetch;

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should log error for inaccessible URL
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Inaccessible URLs detected")
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Only 1 of 2 URLs are accessible")
      );
      // Should still attempt to send
      expect(bot.api.sendMediaGroup).toHaveBeenCalled();
    });

    test("handles GrammyError with error code 400", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
        createMockMediaItem("image", "https://example.com/image2.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mock(async () => "mutation_result"),
      }));

      // Create a bot class that throws error on sendMediaGroup
      const ERROR_CODE_400 = 400;
      class Error400MockBot extends MockBot {
        constructor(token: string) {
          super(token);
          this.api.sendMediaGroup = mock(() =>
            Promise.reject(
              new MockGrammyError(
                "Bad Request",
                ERROR_CODE_400,
                "Invalid media URLs"
              )
            )
          );
          botRegistry.bots.push(this);
        }
      }

      // Temporarily replace Bot class
      mock.module("grammy", () => ({
        Bot: Error400MockBot as any,
        GrammyError: MockGrammyError,
        HttpError: MockHttpError,
        InputMediaBuilder: MockInputMediaBuilder,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should log specific error details for 400
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Bad Request (400) - Common causes")
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid media URLs or file identifiers")
      );
      // Should not mark as sent
      expect(mockGetHttpClient().mutation).not.toHaveBeenCalledWith(
        "markSent",
        expect.anything()
      );

      // Restore original Bot mock
      mock.module("grammy", () => ({
        Bot: class extends MockBot {
          constructor(token: string) {
            super(token);
            botRegistry.bots.push(this);
          }
        } as any,
        GrammyError: MockGrammyError,
        HttpError: MockHttpError,
        InputMediaBuilder: MockInputMediaBuilder,
      }));
    });

    test("handles GrammyError with error code 413", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
        createMockMediaItem("image", "https://example.com/image2.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mock(async () => "mutation_result"),
      }));

      // Create a bot class that throws error on sendMediaGroup
      const ERROR_CODE_413 = 413;
      class Error413MockBot extends MockBot {
        constructor(token: string) {
          super(token);
          this.api.sendMediaGroup = mock(() =>
            Promise.reject(
              new MockGrammyError(
                "Payload Too Large",
                ERROR_CODE_413,
                "File too big"
              )
            )
          );
          botRegistry.bots.push(this);
        }
      }

      // Temporarily replace Bot class
      mock.module("grammy", () => ({
        Bot: Error413MockBot as any,
        GrammyError: MockGrammyError,
        HttpError: MockHttpError,
        InputMediaBuilder: MockInputMediaBuilder,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should log specific error for 413
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Payload Too Large (413)")
      );

      // Restore original Bot mock
      mock.module("grammy", () => ({
        Bot: class extends MockBot {
          constructor(token: string) {
            super(token);
            botRegistry.bots.push(this);
          }
        } as any,
        GrammyError: MockGrammyError,
        HttpError: MockHttpError,
        InputMediaBuilder: MockInputMediaBuilder,
      }));
    });

    test("handles GrammyError with error code 429", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
        createMockMediaItem("image", "https://example.com/image2.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mock(async () => "mutation_result"),
      }));

      // Create a bot class that throws error on sendMediaGroup
      const ERROR_CODE_429 = 429;
      class Error429MockBot extends MockBot {
        constructor(token: string) {
          super(token);
          this.api.sendMediaGroup = mock(() =>
            Promise.reject(
              new MockGrammyError(
                "Rate Limit",
                ERROR_CODE_429,
                "Too many requests"
              )
            )
          );
          botRegistry.bots.push(this);
        }
      }

      // Temporarily replace Bot class
      mock.module("grammy", () => ({
        Bot: Error429MockBot as any,
        GrammyError: MockGrammyError,
        HttpError: MockHttpError,
        InputMediaBuilder: MockInputMediaBuilder,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should log specific error for 429
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Rate Limit (429)")
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("auto-retry should handle this")
      );

      // Restore original Bot mock
      mock.module("grammy", () => ({
        Bot: class extends MockBot {
          constructor(token: string) {
            super(token);
            botRegistry.bots.push(this);
          }
        } as any,
        GrammyError: MockGrammyError,
        HttpError: MockHttpError,
        InputMediaBuilder: MockInputMediaBuilder,
      }));
    });

    test("uses tryPrimaryMedia when post has video_url", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost({
        media_type: "video",
        video_url: "https://example.com/video.mp4",
      });
      const mediaItems: any[] = [];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should use sendVideo for primary media
      expect(bot.api.sendVideo).toHaveBeenCalledWith(
        "123456",
        "https://example.com/video.mp4",
        expect.objectContaining({
          caption: expect.any(String),
          parse_mode: "HTML",
        })
      );
      expect(bot.api.sendMediaGroup).not.toHaveBeenCalled();
      expect(mockMutation).toHaveBeenCalled();
    });

    test("uses trySingleValidMedia when single media item exists", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost({
        // Ensure no display_url so tryPrimaryMedia doesn't succeed first
        display_url: undefined,
      });
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should use sendPhoto for single media
      expect(bot.api.sendPhoto).toHaveBeenCalledWith(
        "123456",
        "https://example.com/image1.jpg",
        expect.objectContaining({
          caption: expect.any(String),
          parse_mode: "HTML",
        })
      );
      expect(bot.api.sendMediaGroup).not.toHaveBeenCalled();
    });

    test("uses sendMessage when no media items", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost({
        // Ensure no display_url or video_url so tryPrimaryMedia doesn't succeed
        display_url: undefined,
        video_url: undefined,
      });
      const mediaItems: any[] = [];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Should use sendMessage as fallback
      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        "123456",
        expect.any(String),
        { parse_mode: "HTML" }
      );
      expect(mockMutation).toHaveBeenCalled();
    });

    test("applies auto-retry plugin configuration", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token";

      const post = createMockPost();
      const mediaItems = [
        createMockMediaItem("image", "https://example.com/image1.jpg"),
        createMockMediaItem("image", "https://example.com/image2.jpg"),
      ];

      const mockQuery = mock((queryName: string, args?: any) => {
        if (queryName === "getUnsent") {
          return Promise.resolve([post]);
        }
        if (
          queryName === "getMediaItemsByPostId" &&
          args?.postId === post._id
        ) {
          return Promise.resolve(mediaItems);
        }
        return Promise.resolve([]);
      });

      const mockMutation = mock(async () => "mutation_result");
      mockGetHttpClient = mock(() => ({
        query: mockQuery,
        mutation: mockMutation,
      }));

      await runTelegramOnce();

      const bot = botRegistry.bots[0];
      if (!bot) {
        throw new Error("Bot instance not created");
      }

      // Track config.use calls
      const configUseSpy = bot.api.config.use;

      // Should apply auto-retry plugin
      expect(configUseSpy).toHaveBeenCalled();
      expect(mockAutoRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 3,
          maxDelaySeconds: 60,
          retryOnInternalServerErrors: true,
        })
      );
    });
  });
});
