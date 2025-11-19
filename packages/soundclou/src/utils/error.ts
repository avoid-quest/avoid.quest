// Common HTTP status code messages for Cloudflare Workers compatibility
const STATUS_MESSAGES: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  414: "URI Too Long",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

class CustomError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ScdlError extends CustomError {}

export class RequestError extends CustomError {
  constructor(statusCode: number) {
    const message = STATUS_MESSAGES[statusCode] || "Unknown Status";
    super(`${statusCode} ${message}`);
  }
}
