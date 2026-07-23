type AudioWorkletsFactory<T> = {
  createFor(context: BaseAudioContext): Promise<T>;
  install(url: string): void;
};

const DEFAULT_OPENDAW_PROCESSOR_URL = "/opendaw/processors.js";
const workletsByContext = new WeakMap<BaseAudioContext, Promise<unknown>>();

async function startOpenDawAnimationFrames(): Promise<void> {
  if (
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    return;
  }
  const { AnimationFrame } = await import("@opendaw/lib-dom");
  AnimationFrame.start(window);
}

function ensureOpenDawAudioWorklets<T>(
  context: BaseAudioContext,
  factory: AudioWorkletsFactory<T>,
  processorUrl = DEFAULT_OPENDAW_PROCESSOR_URL
): Promise<T> {
  const existing = workletsByContext.get(context);
  if (existing) {
    return existing as Promise<T>;
  }

  factory.install(processorUrl);
  const created = Promise.all([
    startOpenDawAnimationFrames(),
    factory.createFor(context),
  ]).then(([, worklets]) => worklets);
  workletsByContext.set(context, created);
  created.catch(() => workletsByContext.delete(context));
  return created;
}

export {
  type AudioWorkletsFactory,
  DEFAULT_OPENDAW_PROCESSOR_URL,
  ensureOpenDawAudioWorklets,
};
