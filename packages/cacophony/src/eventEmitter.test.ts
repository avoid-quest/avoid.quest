// biome-ignore lint/style/useFilenamingConvention: eventEmitter is a common naming pattern for event emitter classes
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { TypedEventEmitter } from "./eventEmitter.js";

// Test event interface
type TestEvents = {
  testEvent: string;
  numberEvent: number;
  objectEvent: { value: number };
  voidEvent: undefined;
};

describe("TypedEventEmitter", () => {
  let emitter: TypedEventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new TypedEventEmitter<TestEvents>();
  });

  describe("Basic functionality", () => {
    it("should register and emit events", () => {
      const listener = mock();
      emitter.on("testEvent", listener);
      emitter.emit("testEvent", "hello");

      expect(listener).toHaveBeenCalledWith("hello");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should support multiple listeners", () => {
      const listener1 = mock();
      const listener2 = mock();

      emitter.on("testEvent", listener1);
      emitter.on("testEvent", listener2);
      emitter.emit("testEvent", "hello");

      expect(listener1).toHaveBeenCalledWith("hello");
      expect(listener2).toHaveBeenCalledWith("hello");
    });

    it("should handle different event types", () => {
      const stringListener = mock();
      const numberListener = mock();
      const objectListener = mock();
      const voidListener = mock();

      emitter.on("testEvent", stringListener);
      emitter.on("numberEvent", numberListener);
      emitter.on("objectEvent", objectListener);
      emitter.on("voidEvent", voidListener);

      emitter.emit("testEvent", "test");
      emitter.emit("numberEvent", 42);
      emitter.emit("objectEvent", { value: 100 });
      emitter.emit("voidEvent", undefined);

      expect(stringListener).toHaveBeenCalledWith("test");
      expect(numberListener).toHaveBeenCalledWith(42);
      expect(objectListener).toHaveBeenCalledWith({ value: 100 });
      expect(voidListener).toHaveBeenCalledWith(undefined);
    });
  });

  describe("once", () => {
    it("should register one-time listeners", () => {
      const listener = mock();
      emitter.once("testEvent", listener);

      emitter.emit("testEvent", "first");
      emitter.emit("testEvent", "second");

      expect(listener).toHaveBeenCalledWith("first");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should return unsubscribe function", () => {
      const listener = mock();
      const unsubscribe = emitter.once("testEvent", listener);

      unsubscribe();
      emitter.emit("testEvent", "test");

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("off", () => {
    it("should remove specific listeners", () => {
      const listener1 = mock();
      const listener2 = mock();

      emitter.on("testEvent", listener1);
      emitter.on("testEvent", listener2);
      emitter.off("testEvent", listener1);
      emitter.emit("testEvent", "test");

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith("test");
    });

    it("should handle removing non-existent listeners", () => {
      const listener = mock();

      expect(() => {
        emitter.off("testEvent", listener);
      }).not.toThrow();
    });
  });

  describe("emitAsync", () => {
    it("should handle async listeners", async () => {
      const asyncListener = mock(() => Promise.resolve(undefined));
      emitter.on("testEvent", asyncListener);

      await emitter.emitAsync("testEvent", "async");

      expect(asyncListener).toHaveBeenCalledWith("async");
    });

    it("should handle listener errors gracefully", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {
        // Suppress console errors in test
      });
      const errorListener = mock(() => Promise.reject(new Error("test error")));
      const successListener = mock(() => Promise.resolve(undefined));

      emitter.on("testEvent", errorListener);
      emitter.on("testEvent", successListener);

      await emitter.emitAsync("testEvent", "test");

      expect(errorListener).toHaveBeenCalledWith("test");
      expect(successListener).toHaveBeenCalledWith("test");
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it("should handle once listeners with async emit", async () => {
      const onceListener = mock(() => Promise.resolve(undefined));
      const regularListener = mock(() => Promise.resolve(undefined));

      emitter.once("testEvent", onceListener);
      emitter.on("testEvent", regularListener);

      await emitter.emitAsync("testEvent", "first");
      await emitter.emitAsync("testEvent", "second");

      expect(onceListener).toHaveBeenCalledWith("first");
      expect(onceListener).toHaveBeenCalledTimes(1);
      expect(regularListener).toHaveBeenCalledTimes(2);
    });

    it("should return undefined when no listeners", async () => {
      const result = await emitter.emitAsync("testEvent", "test");
      expect(result).toBeUndefined();
    });

    it("should handle mixed sync and async listeners", async () => {
      const syncListener = mock();
      const asyncListener = mock(() => Promise.resolve(undefined));

      emitter.on("testEvent", syncListener);
      emitter.on("testEvent", asyncListener);

      await emitter.emitAsync("testEvent", "test");

      expect(syncListener).toHaveBeenCalledWith("test");
      expect(asyncListener).toHaveBeenCalledWith("test");
    });
  });

  describe("removeAllListeners", () => {
    it("should remove all listeners", () => {
      const listener1 = mock();
      const listener2 = mock();

      emitter.on("testEvent", listener1);
      emitter.on("numberEvent", listener2);
      emitter.removeAllListeners();

      emitter.emit("testEvent", "test");
      emitter.emit("numberEvent", 42);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe functionality", () => {
    it("should return unsubscribe function from on()", () => {
      const listener = mock();
      const unsubscribe = emitter.on("testEvent", listener);

      unsubscribe();
      emitter.emit("testEvent", "test");

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
