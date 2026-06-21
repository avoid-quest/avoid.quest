import {
  type AppError,
  type AppErrorInit,
  createRequestId,
  problemResponse,
  runApiRoute,
} from "@avoid.quest/error";
import {
  type CorsHeaders,
  getCorsHeaders,
  getCorsOptionsHeaders,
} from "@/lib/middleware/cors";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";
import { createSessionCookie } from "@/lib/middleware/session";

type ProxyAuthResult = Exclude<
  Awaited<ReturnType<typeof validateAuthAndRateLimit>>,
  Response
>;

type ProxyPolicyDependencies = {
  validateAuthAndRateLimit: typeof validateAuthAndRateLimit;
};

type ProxyRouteContext = {
  auth: ProxyAuthResult;
  origin: string;
  request: Request;
  requestId: string;
};

type ProxyRouteConfig = {
  createSessionIfMissing?: boolean;
  env: Parameters<typeof validateAuthAndRateLimit>[1];
  fallback: Omit<AppErrorInit, "cause">;
  identifier: string;
  operation: string;
  request: Request;
  run: (context: ProxyRouteContext) => Promise<Response>;
};

function resolveProxyOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return "*";
  }
}

function withSessionCookie(response: Response, sessionId: string): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", createSessionCookie(sessionId));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createProxyRequestPolicy(
  dependencies: ProxyPolicyDependencies = {
    validateAuthAndRateLimit,
  }
) {
  const problem = (error: AppError, origin: string, requestId: string) =>
    problemResponse(error, {
      requestId,
      headers: getCorsHeaders(origin),
    });

  const options = (request: Request) => {
    const requestId = createRequestId(request);
    const headers = new Headers(
      getCorsOptionsHeaders(resolveProxyOrigin(request))
    );
    headers.set("x-request-id", requestId);

    return new Response(null, {
      status: 200,
      headers,
    });
  };

  const errorHeaders = (request: Request): CorsHeaders =>
    getCorsHeaders(resolveProxyOrigin(request));

  const run = (config: ProxyRouteConfig): Promise<Response> =>
    runApiRoute({
      request: config.request,
      operation: config.operation,
      fallback: config.fallback,
      errorHeaders: ({ request }) => errorHeaders(request),
      run: async ({ requestId }) => {
        const origin = resolveProxyOrigin(config.request);
        const authResult = await dependencies.validateAuthAndRateLimit(
          config.request,
          config.env,
          config.identifier,
          {
            createSessionIfMissing: config.createSessionIfMissing ?? true,
            requestId,
          }
        );

        if (authResult instanceof Response) {
          return authResult;
        }

        const response = await config.run({
          auth: authResult,
          origin,
          request: config.request,
          requestId,
        });

        if (!authResult.shouldSetCookie) {
          return response;
        }

        return withSessionCookie(response, authResult.sessionId);
      },
    });

  return {
    errorHeaders,
    options,
    problem,
    run,
  };
}
