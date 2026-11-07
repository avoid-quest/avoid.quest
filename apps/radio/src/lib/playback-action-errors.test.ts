import { expect, spyOn, test } from "bun:test";
import { AppError } from "@avoid.quest/error";
// biome-ignore lint/performance/noNamespaceImport: observe reporting without sending telemetry
import * as Sentry from "@sentry/core";
import {
  capturePlaybackActionError,
  createPlaybackActionError,
  toRuntimeAudioError,
} from "./playback-action-errors";

test("support limits preserve guidance; ordinary media failures still reach Sentry", () => {
  const enabled = spyOn(Sentry, "isEnabled").mockReturnValue(true);
  const capture = spyOn(Sentry, "captureException").mockReturnValue("test");
  const support = new AppError({
    category: "validation",
    code: "UNSUPPORTED_RADIO_GRAPH",
    expected: true,
    safeMessage: "Safari plays live radio and HLS only in Single.",
  });
  const failure = new DOMException(
    "The operation is not supported.",
    "NotSupportedError"
  );
  // RADIO-22 symptom: MEDIA_ERR_SRC_NOT_SUPPORTED mapped by mediaElementError.
  // Keep reporting unexpected stream failures; do not silence the diagnostic.
  const unsupportedStream = new Error("Audio stream format is not supported");
  try {
    expect(toRuntimeAudioError(support).message).toBe(support.safeMessage);
    capturePlaybackActionError(
      createPlaybackActionError({ cause: support, mode: "node" })
    );
    expect(capture).not.toHaveBeenCalled();
    expect(toRuntimeAudioError(failure).message).toBe(
      "Playback could not start. Check the station stream and try again."
    );
    capturePlaybackActionError(
      createPlaybackActionError({ cause: failure, mode: "single" })
    );
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0]).toBe(failure);
    const unsupportedAction = createPlaybackActionError({
      cause: unsupportedStream,
      mode: "single",
    });
    expect(unsupportedAction.userMessage).toBe(
      "The stream could not be reached. Check the station URL and try again."
    );
    capturePlaybackActionError(unsupportedAction);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1]?.[0]).toBe(unsupportedStream);
  } finally {
    capture.mockRestore();
    enabled.mockRestore();
  }
});
