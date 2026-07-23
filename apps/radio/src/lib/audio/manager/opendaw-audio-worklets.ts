type AudioWorkletsFactory<T> = {
  createFor(context: BaseAudioContext): Promise<T>;
  install(url: string): void;
};

const DEFAULT_OPENDAW_PROCESSOR_URL = "/opendaw/processors.js";
const workletsByContext = new WeakMap<BaseAudioContext, Promise<unknown>>();

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
  const created = factory.createFor(context);
  workletsByContext.set(context, created);
  created.catch(() => workletsByContext.delete(context));
  return created;
}

export {
  type AudioWorkletsFactory,
  DEFAULT_OPENDAW_PROCESSOR_URL,
  ensureOpenDawAudioWorklets,
};
