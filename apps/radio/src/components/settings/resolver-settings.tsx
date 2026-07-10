"use client";

import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
  addResolverService,
  getResolverConfiguration,
  MAX_RESOLVER_SERVICES,
  ResolverConfigurationError,
  type ResolverService,
  removeResolverService,
  reorderResolverServices,
  setResolverServiceEnabled,
} from "@/lib/resolver";

function capabilityLabel(capability: string): string {
  return capability.replace(":", " ");
}

export function ResolverSettings({
  compatibilityFallbacksEnabled,
}: {
  compatibilityFallbacksEnabled: boolean;
}) {
  const [configuration, setConfiguration] = useState(getResolverConfiguration);
  const [baseUrl, setBaseUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    setIsAdding(true);
    try {
      const next = await addResolverService({ baseUrl: baseUrl.trim() });
      setConfiguration(next);
      setBaseUrl("");
      toast.success("Resolver verified and added");
    } catch (error) {
      toast.error(
        error instanceof ResolverConfigurationError
          ? error.message
          : "Resolver verification failed"
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggle = (service: ResolverService) => {
    setConfiguration(
      setResolverServiceEnabled(service.baseUrl, !service.enabled)
    );
  };

  const handleRemove = (service: ResolverService) => {
    setConfiguration(removeResolverService(service.baseUrl));
  };

  const handleMove = (index: number, offset: -1 | 1) => {
    const orderedBaseUrls = configuration.services.map(
      ({ baseUrl: serviceBaseUrl }) => serviceBaseUrl
    );
    const [serviceBaseUrl] = orderedBaseUrls.splice(index, 1);
    if (!serviceBaseUrl) {
      return;
    }
    orderedBaseUrls.splice(index + offset, 0, serviceBaseUrl);
    setConfiguration(reorderResolverServices(orderedBaseUrls));
  };

  return (
    <>
      <div className="rounded-lg border border-border/50 p-3">
        <h4 className="text-sm">Platform resolvers</h4>
        <p className="mt-1 text-muted-foreground text-xs">
          Add browser-compatible resolvers for Bandcamp, SoundCloud, and Radio
          Garden search and stream resolution. Enabled services are tried in the
          order shown.
        </p>

        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={handleAdd}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="sr-only" htmlFor="resolver-base-url">
              Resolver base URL
            </Label>
            <Input
              autoComplete="off"
              disabled={isAdding}
              id="resolver-base-url"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://resolver.example"
              type="url"
              value={baseUrl}
            />
          </div>
          <Button
            disabled={
              isAdding ||
              !baseUrl.trim() ||
              configuration.services.length >= MAX_RESOLVER_SERVICES
            }
            type="submit"
          >
            {isAdding && <Loader2Icon className="size-3.5 animate-spin" />}
            Verify & Add
          </Button>
        </form>

        <p className="mt-2 text-[10px] text-muted-foreground/60">
          The endpoint must expose the avoid-radio resolver manifest and allow
          this app through CORS. HTTPS is required outside localhost. Requests
          omit app cookies, credentials, and referrers.
        </p>
      </div>

      {configuration.services.length === 0 ? (
        <div className="rounded-lg border border-border/50 border-dashed p-4 text-center text-muted-foreground text-xs">
          No external resolvers configured.{" "}
          {compatibilityFallbacksEnabled
            ? "The avoid.quest resolver remains last."
            : "Only configured external resolvers will be attempted."}
        </div>
      ) : (
        <div className="space-y-2">
          {configuration.services.map((service, index) => (
            <div
              className="flex items-center gap-2 rounded-lg border border-border/50 p-3"
              key={service.baseUrl}
            >
              <input
                aria-label={`Enable ${service.name}`}
                checked={service.enabled}
                className="size-4 shrink-0 cursor-pointer accent-primary"
                onChange={() => handleToggle(service)}
                type="checkbox"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{service.name}</div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {service.baseUrl}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {service.capabilities.map((capability) => (
                    <span
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase"
                      key={capability}
                    >
                      {capabilityLabel(capability)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  aria-label={`Move ${service.name} up`}
                  disabled={index === 0}
                  onClick={() => handleMove(index, -1)}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowUpIcon className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Move ${service.name} down`}
                  disabled={index === configuration.services.length - 1}
                  onClick={() => handleMove(index, 1)}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowDownIcon className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Remove ${service.name}`}
                  onClick={() => handleRemove(service)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        Resolvers can see provider searches and source URLs, but they do not
        receive audio unless a returned stream later needs a configured relay.
        Only add endpoints you trust.
      </div>
    </>
  );
}
