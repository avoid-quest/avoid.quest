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
  // Pass through to network - no caching for live streaming
  event.respondWith(fetch(event.request));
});
