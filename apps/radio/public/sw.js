// Service worker for Radio Proxy PWA - Online only, no caching
// Minimal service worker for PWA installation only

// Install event - minimal setup
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Activate event - minimal activation
self.addEventListener("activate", () => {
  self.clients.claim();
});
