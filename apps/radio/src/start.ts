import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { appErrorSerialization } from "@/lib/app-error-serialization";

export const startInstance = createStart(() => ({
  functionMiddleware: [sentryGlobalFunctionMiddleware],
  requestMiddleware: [
    sentryGlobalRequestMiddleware,
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
  ],
  serializationAdapters: [appErrorSerialization],
}));
