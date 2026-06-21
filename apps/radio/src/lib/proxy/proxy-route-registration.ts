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
  internalErrorCode: AppErrorInit["code"];
  operation: string;
};

function createInternalErrorFallback(
  internalErrorCode: AppErrorInit["code"]
): Omit<AppErrorInit, "cause"> {
  return {
    code: internalErrorCode,
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
  internalErrorCode,
  operation,
}: ProxyRouteRegistrationConfig) {
  const proxyPolicy = createProxyRequestPolicy();
  const workflow = createWorkflow(proxyPolicy);

  return {
    handlers: {
      GET: proxyPolicy.get({
        env,
        identifier,
        operation,
        fallback: createInternalErrorFallback(internalErrorCode),
        run: workflow.handle,
      }),
      OPTIONS: ({ request }: { request: Request }) =>
        proxyPolicy.options(request),
    },
  };
}
