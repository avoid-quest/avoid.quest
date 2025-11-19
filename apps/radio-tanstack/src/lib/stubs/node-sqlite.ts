// Stub for node:sqlite - not available in Cloudflare Workers
// This is used by undici's sqlite-cache-store which we don't use in Workers

// Stub class - undici will fall back to memory cache in Workers
class DatabaseSync {
  // Empty stub - not used in Cloudflare Workers environment
}

const stub = {
  DatabaseSync,
};

// Support both ESM and CommonJS
export { DatabaseSync };
export default stub;

// CommonJS support for require() calls
if (typeof module !== "undefined" && module.exports) {
  module.exports = stub;
  module.exports.DatabaseSync = DatabaseSync;
}
