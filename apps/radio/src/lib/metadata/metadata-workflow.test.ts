import { describe, expect, test } from "bun:test";
import { createRadioMetadataWorkflow } from "./metadata-workflow";

function createRequest(metadataUrls: string[]): Request {
  const params = new URLSearchParams({
    kind: "airtime-live-info",
    url: "https://radio.example/live.mp3",
  });
  for (const url of metadataUrls) {
    params.append("metadataUrl", url);
  }
  return new Request(`https://app.example/api/radio-metadata?${params}`);
}

describe("createRadioMetadataWorkflow", () => {
  test("rejects excessive Airtime metadata URL fan-out", async () => {
    const workflow = createRadioMetadataWorkflow();
    const response = await workflow.handle({
      origin: "https://app.example",
      request: createRequest([
        "https://one.example/api/live-info",
        "https://two.example/api/live-info",
        "https://three.example/api/live-info",
        "https://four.example/api/live-info",
        "https://five.example/api/live-info",
        "https://six.example/api/live-info",
      ]),
      requestId: "test-request",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "RADIO_METADATA_INVALID_URL" },
    });
  });

  test("rejects duplicate Airtime metadata URLs", async () => {
    const workflow = createRadioMetadataWorkflow();
    const response = await workflow.handle({
      origin: "https://app.example",
      request: createRequest([
        "https://one.example/api/live-info",
        "https://one.example/api/live-info",
      ]),
      requestId: "test-request",
    });

    expect(response.status).toBe(400);
  });
});
