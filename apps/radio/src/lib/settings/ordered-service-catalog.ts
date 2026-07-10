export type OrderedServiceConfiguration<Service> = {
  services: Service[];
  version: 1;
};

type OrderedService = { enabled: boolean };

type CatalogMessages = {
  duplicate: string;
  limit: (maxServices: number) => string;
  malformed: string;
  order: string;
  unknown: string;
};

type CatalogOptions<Service extends OrderedService> = {
  createError: (message: string) => Error;
  getKey: (service: Service) => string;
  maxServices: number;
  messages: CatalogMessages;
  normalizeService: (value: unknown) => Service;
  storageKey: string;
  validateServices?: (services: readonly Service[]) => void;
};

export function createOrderedServiceCatalog<Service extends OrderedService>(
  options: CatalogOptions<Service>
) {
  type Configuration = OrderedServiceConfiguration<Service>;
  const empty = (): Configuration => ({ services: [], version: 1 });

  const normalizeServices = (values: readonly unknown[]): Service[] => {
    if (values.length > options.maxServices) {
      throw options.createError(options.messages.limit(options.maxServices));
    }
    const services = values.map(options.normalizeService);
    if (new Set(services.map(options.getKey)).size !== services.length) {
      throw options.createError(options.messages.duplicate);
    }
    options.validateServices?.(services);
    return services;
  };

  const parse = (value: unknown): Configuration => {
    if (!value || typeof value !== "object") {
      throw options.createError(options.messages.malformed);
    }
    const configuration = value as Record<string, unknown>;
    if (configuration.version !== 1 || !Array.isArray(configuration.services)) {
      throw options.createError(options.messages.malformed);
    }
    return { services: normalizeServices(configuration.services), version: 1 };
  };

  const persist = (
    services: readonly unknown[],
    storage: Storage | null
  ): Configuration => {
    const configuration = {
      services: normalizeServices(services),
      version: 1,
    } as const;
    storage?.setItem(options.storageKey, JSON.stringify(configuration));
    return configuration;
  };

  const read = (storage: Storage | null): Configuration => {
    try {
      const raw = storage?.getItem(options.storageKey);
      return raw ? parse(JSON.parse(raw)) : empty();
    } catch {
      return empty();
    }
  };

  return {
    append(service: Service, storage: Storage | null): Configuration {
      const current = read(storage);
      return persist([...current.services, service], storage);
    },
    clear(storage: Storage | null): void {
      storage?.removeItem(options.storageKey);
    },
    read,
    remove(key: string, storage: Storage | null): Configuration {
      const current = read(storage);
      return persist(
        current.services.filter((service) => options.getKey(service) !== key),
        storage
      );
    },
    reorder(keys: readonly string[], storage: Storage | null): Configuration {
      const current = read(storage);
      const servicesByKey = new Map(
        current.services.map((service) => [options.getKey(service), service])
      );
      if (
        keys.length !== current.services.length ||
        new Set(keys).size !== keys.length ||
        keys.some((key) => !servicesByKey.has(key))
      ) {
        throw options.createError(options.messages.order);
      }
      return persist(
        keys.map((key) => {
          const service = servicesByKey.get(key);
          if (!service) {
            throw options.createError(options.messages.unknown);
          }
          return service;
        }),
        storage
      );
    },
    replace(
      services: readonly unknown[],
      storage: Storage | null
    ): Configuration {
      return persist(services, storage);
    },
    setEnabled(
      key: string,
      enabled: boolean,
      storage: Storage | null
    ): Configuration {
      const current = read(storage);
      return persist(
        current.services.map((service) =>
          options.getKey(service) === key ? { ...service, enabled } : service
        ),
        storage
      );
    },
  };
}
