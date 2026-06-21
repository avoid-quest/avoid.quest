import type { AppErrorInit } from "@avoid.quest/error";
import { createProxyRequestPolicy } from "./request-policy";

type ProxyRequestPolicy = ReturnType<typeof createProxyRequestPolicy>;
type ProxyGetConfig = Parameters<ProxyRequestPolicy["get"]>[0];

type ProxyRouteWorkflow = {
  handle: ProxyGetConfig["run"];
};

type ProxyRouteRegistrationConfig = {
  createWorkflow: (proxyPolicy: ProxyRequestPolicy) => ProxyRouteWorkflow;
  env: ProxyGetConfig["env"];
  identifier: string;
};

function createInternalErrorFallback(
  identifier: string
): Omit<AppErrorInit, "cause"> {
  return {
    code: `${identifier.replaceAll("-", "_").toUpperCase()}_INTERNAL_ERROR`,
    safeMessage: "Internal server error",
    category: "infrastructure",
    expected: false,
    status: 500,
  };
}

export function createProxyRouteRegistration({
  createWorkflow,
  env,
  identifier,
}: ProxyRouteRegistrationConfig) {
  const proxyPolicy = createProxyRequestPolicy();
  const workflow = createWorkflow(proxyPolicy);

  return {
    handlers: {
      GET: proxyPolicy.get({
        env,
        identifier,
        operation: `${identifier}.GET`,
        fallback: createInternalErrorFallback(identifier),
        run: workflow.handle,
      }),
      OPTIONS: ({ request }: { request: Request }) =>
        proxyPolicy.options(request),
    },
  };
}
