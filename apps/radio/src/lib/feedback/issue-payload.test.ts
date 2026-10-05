import { expect, test } from "bun:test";
import path from "node:path";

test("the real feedback endpoint sends no legacy contact email to GitHub or logs", async () => {
  // A fresh process keeps the endpoint unit suite's module mocks out of this
  // check. Exercise the actual git-feedback formatter and GitHub adapter.
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    const payloads = [];
    globalThis.fetch = async (url, options) => {
      if (String(url) !== "https://api.github.com/repos/avoid-quest/avoid.quest/issues") {
        throw new Error("Unexpected network request");
      }
      payloads.push(JSON.parse(options.body));
      return Response.json({ number: 1, title: "Feedback", html_url: "https://github.com/avoid-quest/avoid.quest/issues/1" });
    };
    const { handleFeedbackRequest } = await import("./src/lib/feedback/endpoint.ts");
    const form = new FormData();
    form.set("body", "Playback stopped");
    form.set("category", "bug");
    form.set("userAgent", "Test Browser");
    form.set("pageUrl", "https://radio.test/?email=private@example.com#private");
    form.set("untrustedMetadata", JSON.stringify({ contactEmail: "private@example.com", mode: "node", extraEmail: "private@example.com" }));
    const response = await handleFeedbackRequest(new Request("https://radio.test/api/feedback", {
      method: "POST", headers: { "cf-connecting-ip": "203.0.113.10" }, body: form,
    }), { GIT_FEEDBACK_GITHUB_TOKEN: "test-token", "proxy-rate-limit": { limit: async () => ({ success: true }) } });
    console.log(JSON.stringify({ status: response.status, payloads }));
  `,
    ],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const output = await new Response(child.stdout).text();
  const errors = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(output + errors).not.toContain("private@example.com");
  const result = JSON.parse(output);
  expect(result.status).toBe(201);
  expect(result.payloads).toHaveLength(1);
  expect(result.payloads[0]).toMatchObject({
    labels: ["git-feedback", "radio", "bug"],
    title: "[GF]: Playback stopped",
  });
  expect(result.payloads[0].body).toContain("| Mode | Node |");
  expect(result.payloads[0].body).toContain("Test Browser");
});
