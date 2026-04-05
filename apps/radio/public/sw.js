// Minimal Service Worker for Radio PWA
// No caching - this app streams live radio and requires network connectivity

// Install event - skip waiting to activate immediately
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Activate event - take control of all clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch event - always fetch from network (no caching)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const accept = event.request.headers.get("accept") || "";
  const hasRangeHeader = event.request.headers.has("range");
  const isStreamingProxyRoute =
    url.pathname === "/api/stream-proxy" ||
    url.pathname === "/api/bandcamp-proxy" ||
    url.pathname === "/api/soundcloud-proxy";

  // Don't intercept cross-origin requests (external streams)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Don't intercept streaming requests or proxy passthroughs
  if (
    isStreamingProxyRoute ||
    hasRangeHeader ||
    accept.startsWith("audio/") ||
    event.request.destination === "audio" ||
    event.request.destination === "video"
  ) {
    return;
  }

  // Pass through to network - no caching for live streaming
  event.respondWith(fetch(event.request));
});
