// Minimal Service Worker for InstaRip PWA
// No aggressive caching - this app requires network for Convex data

const CACHE_NAME = "instarip-v1";

// Install event - skip waiting to activate immediately
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Activate event - take control of all clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up old caches
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter((name) => name !== CACHE_NAME)
              .map((name) => caches.delete(name))
          )
        ),
    ])
  );
});

// Fetch event - network first, no caching for dynamic content
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Don't intercept cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Don't intercept Convex WebSocket or API calls
  if (url.pathname.includes("convex") || url.pathname.includes("api")) {
    return;
  }

  // Pass through to network
  event.respondWith(fetch(event.request));
});
