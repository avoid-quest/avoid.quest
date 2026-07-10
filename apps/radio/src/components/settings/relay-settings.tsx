"use client";

import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
  getCompatibilityFallbacksEnabled,
  setCompatibilityFallbacksEnabled,
} from "@/lib/compatibility-fallback-policy";
import {
  addRelayService,
  getRelayConfiguration,
  RelayConfigurationError,
  type RelayService,
  removeRelayService,
  reorderRelayServices,
  setRelayServiceEnabled,
} from "@/lib/relay";
import {
  addVerifiedYouTubeProviderService,
  getYouTubeProviderConfiguration,
  MAX_YOUTUBE_PROVIDER_SERVICES,
  removeYouTubeProviderService,
  reorderYouTubeProviderServices,
  setYouTubeProviderServiceEnabled,
  type YouTubeProviderService,
} from "@/lib/youtube";
import { ResolverSettings } from "./resolver-settings";

export function RelaySettings() {
  const [compatibilityFallbacksEnabled, setCompatibilityFallbacksState] =
    useState(getCompatibilityFallbacksEnabled);
  const [relayConfiguration, setRelayConfiguration] = useState(
    getRelayConfiguration
  );
  const [relayBaseUrl, setRelayBaseUrl] = useState("");
  const [isAddingRelay, setIsAddingRelay] = useState(false);
  const [youtubeConfiguration, setYouTubeConfiguration] = useState(
    getYouTubeProviderConfiguration
  );
  const [youtubeBaseUrl, setYouTubeBaseUrl] = useState("");
  const [youtubeKind, setYouTubeKind] =
    useState<YouTubeProviderService["kind"]>("invidious");
  const [isAddingYouTube, setIsAddingYouTube] = useState(false);

  const handleAddRelay = async (event: FormEvent) => {
    event.preventDefault();
    setIsAddingRelay(true);
    try {
      const next = await addRelayService({ baseUrl: relayBaseUrl.trim() });
      setRelayConfiguration(next);
      setRelayBaseUrl("");
      toast.success("Relay verified and added");
    } catch (error) {
      toast.error(
        error instanceof RelayConfigurationError
          ? error.message
          : "Relay verification failed"
      );
    } finally {
      setIsAddingRelay(false);
    }
  };

  const handleRelayToggle = (service: RelayService) => {
    setRelayConfiguration(
      setRelayServiceEnabled(service.baseUrl, !service.enabled)
    );
  };

  const handleRelayRemove = (service: RelayService) => {
    setRelayConfiguration(removeRelayService(service.baseUrl));
  };

  const handleRelayMove = (index: number, offset: -1 | 1) => {
    const orderedBaseUrls = relayConfiguration.services.map(
      ({ baseUrl }) => baseUrl
    );
    const [baseUrl] = orderedBaseUrls.splice(index, 1);
    if (!baseUrl) {
      return;
    }
    orderedBaseUrls.splice(index + offset, 0, baseUrl);
    setRelayConfiguration(reorderRelayServices(orderedBaseUrls));
  };

  const handleCompatibilityFallbackToggle = () => {
    setCompatibilityFallbacksState(
      setCompatibilityFallbacksEnabled(!compatibilityFallbacksEnabled)
    );
  };

  const handleAddYouTube = async (event: FormEvent) => {
    event.preventDefault();
    setIsAddingYouTube(true);
    try {
      const input = { baseUrl: youtubeBaseUrl.trim(), kind: youtubeKind };
      setYouTubeConfiguration(await addVerifiedYouTubeProviderService(input));
      setYouTubeBaseUrl("");
      toast.success("YouTube provider verified and added");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "YouTube provider verification failed"
      );
    } finally {
      setIsAddingYouTube(false);
    }
  };

  const handleYouTubeToggle = (service: YouTubeProviderService) => {
    setYouTubeConfiguration(
      setYouTubeProviderServiceEnabled(service.id, !service.enabled)
    );
  };

  const handleYouTubeRemove = (service: YouTubeProviderService) => {
    setYouTubeConfiguration(removeYouTubeProviderService(service.id));
  };

  const handleYouTubeMove = (index: number, offset: -1 | 1) => {
    const orderedIds = youtubeConfiguration.services.map(({ id }) => id);
    const [id] = orderedIds.splice(index, 1);
    if (!id) {
      return;
    }
    orderedIds.splice(index + offset, 0, id);
    setYouTubeConfiguration(reorderYouTubeProviderServices(orderedIds));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-border/50 p-3">
        <input
          aria-checked={compatibilityFallbacksEnabled}
          aria-label="Allow avoid.quest compatibility fallbacks"
          checked={compatibilityFallbacksEnabled}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
          onChange={handleCompatibilityFallbackToggle}
          role="switch"
          type="checkbox"
        />
        <div>
          <h4 className="text-sm">avoid.quest compatibility fallbacks</h4>
          <p className="mt-1 text-muted-foreground text-xs">
            Keep temporary app-server resolvers and audio proxies available as
            the last fallback. Turn this off for client and configured external
            services only. YouTube is unaffected.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 p-3">
        <h4 className="text-sm">YouTube providers</h4>
        <p className="mt-1 text-muted-foreground text-xs">
          Add browser-compatible Invidious or Piped services. They are tried in
          the order shown for search, playlists, and playable audio.
        </p>

        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={handleAddYouTube}
        >
          <Select
            disabled={isAddingYouTube}
            onValueChange={(value) =>
              setYouTubeKind(value as YouTubeProviderService["kind"])
            }
            value={youtubeKind}
          >
            <SelectTrigger
              aria-label="YouTube provider type"
              className="sm:w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="invidious">Invidious</SelectItem>
              <SelectItem value="piped">Piped</SelectItem>
            </SelectContent>
          </Select>
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="sr-only" htmlFor="youtube-provider-base-url">
              YouTube provider base URL
            </Label>
            <Input
              autoComplete="off"
              disabled={isAddingYouTube}
              id="youtube-provider-base-url"
              onChange={(event) => setYouTubeBaseUrl(event.target.value)}
              placeholder="https://invidious.example"
              type="url"
              value={youtubeBaseUrl}
            />
          </div>
          <Button
            disabled={
              isAddingYouTube ||
              !youtubeBaseUrl.trim() ||
              youtubeConfiguration.services.length >=
                MAX_YOUTUBE_PROVIDER_SERVICES
            }
            type="submit"
          >
            {isAddingYouTube && (
              <Loader2Icon className="size-3.5 animate-spin" />
            )}
            Verify & Add
          </Button>
        </form>

        <p className="mt-2 text-[10px] text-muted-foreground/60">
          Providers must allow this app through CORS. Invidious deployments may
          require Companion; Piped requires its API proxy. HTTPS is required
          outside localhost.
        </p>
      </div>

      {youtubeConfiguration.services.length === 0 ? (
        <div className="rounded-lg border border-border/50 border-dashed p-4 text-center text-muted-foreground text-xs">
          No YouTube providers configured. YouTube search and playback stay
          unavailable until a verified provider is added.
        </div>
      ) : (
        <div className="space-y-2">
          {youtubeConfiguration.services.map((service, index) => (
            <div
              className="flex items-center gap-2 rounded-lg border border-border/50 p-3"
              key={service.id}
            >
              <input
                aria-label={`Enable ${service.name}`}
                checked={service.enabled}
                className="size-4 shrink-0 cursor-pointer accent-primary"
                onChange={() => handleYouTubeToggle(service)}
                type="checkbox"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate">{service.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase">
                    {service.kind}
                  </span>
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {service.baseUrl}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  aria-label={`Move ${service.name} up`}
                  disabled={index === 0}
                  onClick={() => handleYouTubeMove(index, -1)}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowUpIcon className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Move ${service.name} down`}
                  disabled={index === youtubeConfiguration.services.length - 1}
                  onClick={() => handleYouTubeMove(index, 1)}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowDownIcon className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Remove ${service.name}`}
                  onClick={() => handleYouTubeRemove(service)}
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

      <ResolverSettings
        compatibilityFallbacksEnabled={compatibilityFallbacksEnabled}
      />

      <div className="rounded-lg border border-border/50 p-3">
        <h4 className="text-sm">External stream relays</h4>
        <p className="mt-1 text-muted-foreground text-xs">
          Direct playback is always tried first. A trusted relay receives the
          source URL and audio only when the browser cannot use the origin.
        </p>

        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={handleAddRelay}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="sr-only" htmlFor="relay-base-url">
              Relay base URL
            </Label>
            <Input
              autoComplete="off"
              disabled={isAddingRelay}
              id="relay-base-url"
              onChange={(event) => setRelayBaseUrl(event.target.value)}
              placeholder="https://relay.example"
              type="url"
              value={relayBaseUrl}
            />
          </div>
          <Button
            disabled={isAddingRelay || !relayBaseUrl.trim()}
            type="submit"
          >
            {isAddingRelay && <Loader2Icon className="size-3.5 animate-spin" />}
            Verify & Add
          </Button>
        </form>

        <p className="mt-2 text-[10px] text-muted-foreground/60">
          The service must expose /.well-known/avoid-radio-relay.json, allow
          this app through CORS, and advertise progressive stream and/or
          full-HLS relay capability. HTTPS is required outside localhost.
        </p>
      </div>

      {relayConfiguration.services.length === 0 ? (
        <div className="rounded-lg border border-border/50 border-dashed p-4 text-center text-muted-foreground text-xs">
          No external relays configured.{" "}
          {compatibilityFallbacksEnabled
            ? "The temporary avoid.quest fallback remains last."
            : "Only direct browser playback will be attempted."}
        </div>
      ) : (
        <div className="space-y-2">
          {relayConfiguration.services.map((service, index) => (
            <div
              className="flex items-center gap-3 rounded-lg border border-border/50 p-3"
              key={service.baseUrl}
            >
              <input
                aria-label={`Enable ${service.name}`}
                checked={service.enabled}
                className="size-4 shrink-0 cursor-pointer accent-primary"
                onChange={() => handleRelayToggle(service)}
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
                      {capability === "stream" ? "progressive" : "full HLS"}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  aria-label={`Move ${service.name} up`}
                  disabled={index === 0}
                  onClick={() => handleRelayMove(index, -1)}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowUpIcon className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Move ${service.name} down`}
                  disabled={index === relayConfiguration.services.length - 1}
                  onClick={() => handleRelayMove(index, 1)}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowDownIcon className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Remove ${service.name}`}
                  onClick={() => handleRelayRemove(service)}
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
        Relays can see requested source URLs and all relayed audio. Never add a
        public relay you do not trust; app cookies and credentials are omitted.
      </div>
    </div>
  );
}
