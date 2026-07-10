import { describe, expect, test } from "bun:test";
import { isLoopbackHostname, isLoopbackHttpUrl } from "./hostname";

describe("loopback hostname policy", () => {
  test("recognizes canonical IPv4-mapped IPv6 loopback addresses", () => {
    expect(isLoopbackHostname("::ffff:7f00:1")).toBeTrue();
    expect(isLoopbackHostname("::ffff:7fff:ffff")).toBeTrue();
    expect(isLoopbackHttpUrl("http://[::ffff:127.0.0.1]/stream")).toBeTrue();
  });

  test("does not treat public IPv4-mapped IPv6 addresses as loopback", () => {
    expect(isLoopbackHostname("::ffff:0808:0808")).toBeFalse();
    expect(isLoopbackHttpUrl("http://[::ffff:8.8.8.8]/stream")).toBeFalse();
  });
});
