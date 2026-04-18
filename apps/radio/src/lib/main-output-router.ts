import {
  createOutputRouter,
  getAudioContext,
  type OutputRouter,
} from "@/lib/audio";

let outputRouter: OutputRouter | null = null;
const errorListeners = new Set<(error: Error) => void>();

function emitOutputRouterError(error: Error): void {
  for (const listener of errorListeners) {
    listener(error);
  }
}

export function getMainOutputRouter(): OutputRouter | null {
  const context = getAudioContext();
  if (!context) {
    return null;
  }

  if (!outputRouter) {
    outputRouter = createOutputRouter(context, {
      onError: emitOutputRouterError,
    });
  }

  return outputRouter;
}

export function onMainOutputRouterError(
  listener: (error: Error) => void
): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}
