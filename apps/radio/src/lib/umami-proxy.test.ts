import { describe, expect, test } from "bun:test";
import { handleUmamiRequest } from "./umami-proxy";

const ORIGIN = "https://radio.avoid.quest";

describe("Umami first-party proxy", () => {
  test("serves only the fixed script without forwarding query targets or cookies", async () => {
    const response = await handleUmamiRequest(
      new Request(`${ORIGIN}/u/script.js?url=https://elsewhere.example`, {
        headers: { Authorization: "Bearer private", Cookie: "session=private" },
      }),
      (input, init) => {
        expect(String(input)).toBe("https://umami.net-work.studio/script.js");
        expect(init?.method).toBe("GET");
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
        expect(new Headers(init?.headers).has("Cookie")).toBe(false);
        return Promise.resolve(
          new Response("window.umami = {};", {
            headers: {
              "Content-Type": "application/javascript",
              "Set-Cookie": "upstream=private",
            },
          })
        );
      }
    );
    expect(await response.text()).toBe("window.umami = {};");
    expect(response.headers.get("Content-Type")).toBe("application/javascript");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });

  test("preserves event bytes, visitor metadata and Umami's session response", async () => {
    const body = '{"type":"event","payload":{"url":"/"}}';
    const response = await handleUmamiRequest(
      new Request(`${ORIGIN}/u/api/send`, {
        body,
        headers: {
          "CF-Connecting-IP": "203.0.113.42",
          "CF-IPCity": "Rome",
          "CF-IPCountry": "IT",
          "CF-Region-Code": "62",
          "Content-Type": "application/json",
          "True-Client-IP": "spoofed",
          "User-Agent": "Visitor browser",
          "X-Forwarded-For": "spoofed",
          "x-umami-cache": "previous-session",
          "x-umami-hostname": "radio.avoid.quest",
          "x-umami-website-id": "3c1fb87b-fc98-4b89-b359-59f386c01ad3",
        },
        method: "POST",
      }),
      async (input, init) => {
        const upstream = new Request(input, init);
        expect(upstream.url).toBe("https://umami.net-work.studio/api/send");
        expect(upstream.method).toBe("POST");
        expect(await upstream.text()).toBe(body);
        expect(Object.fromEntries(upstream.headers)).toEqual({
          "cf-ipcity": "Rome",
          "cf-ipcountry": "IT",
          "cf-region-code": "62",
          "content-type": "application/json",
          "true-client-ip": "203.0.113.42",
          "user-agent": "Visitor browser",
          "x-umami-cache": "previous-session",
          "x-umami-hostname": "radio.avoid.quest",
          "x-umami-website-id": "3c1fb87b-fc98-4b89-b359-59f386c01ad3",
        });
        return new Response('{"cache":"next-session","disabled":false}');
      }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe(
      '{"cache":"next-session","disabled":false}'
    );
  });

  test.each([
    ["/u/api/auth/login", "POST", 404],
    ["/u//elsewhere.example/script.js", "GET", 404],
    ["/u/script.js", "POST", 405],
    ["/u/api/send", "GET", 405],
  ])("rejects %s with %s before fetching", async (path, method, status) => {
    let fetched = false;
    const response = await handleUmamiRequest(
      new Request(`${ORIGIN}${path}`, { method }),
      () => {
        fetched = true;
        return Promise.resolve(new Response());
      }
    );
    expect(response.status).toBe(status);
    expect(fetched).toBe(false);
  });

  test("preserves upstream failures and retry hints without caching them", async () => {
    const response = await handleUmamiRequest(
      new Request(`${ORIGIN}/u/script.js`),
      () =>
        Promise.resolve(
          new Response("slow down", {
            headers: { "Retry-After": "60" },
            status: 429,
          })
        )
    );
    expect(response.status).toBe(429);
    expect(await response.text()).toBe("slow down");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("refuses upstream redirects without exposing their destination", async () => {
    const response = await handleUmamiRequest(
      new Request(`${ORIGIN}/u/script.js`),
      () => Promise.resolve(Response.redirect("https://elsewhere.example", 302))
    );
    expect(response.status).toBe(502);
    expect(response.headers.has("Location")).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("returns an uncached gateway error for network failures", async () => {
    const response = await handleUmamiRequest(
      new Request(`${ORIGIN}/u/script.js`),
      () => Promise.reject(new TypeError("fetch failed"))
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("serves HEAD without a response body or a fabricated visitor IP", async () => {
    const response = await handleUmamiRequest(
      new Request(`${ORIGIN}/u/script.js`, { method: "HEAD" }),
      (_input, init) => {
        expect(init?.method).toBe("HEAD");
        expect(new Headers(init?.headers).has("True-Client-IP")).toBe(false);
        return Promise.resolve(new Response(null));
      }
    );
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });
});
