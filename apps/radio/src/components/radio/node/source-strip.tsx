/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Knob } from "@avoid.quest/ui/components/knob";
import { Switch } from "@avoid.quest/ui/components/switch";
import { Toggle } from "@avoid.quest/ui/components/toggle";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  HeadphonesIcon,
  MapPinIcon,
  Repeat1Icon,
  SkipBackIcon,
} from "lucide-react";
import { useId, useRef } from "react";
import type { ChannelSelection } from "@/lib/audio";
import { usePeakLevel } from "@/lib/hooks/use-peak-level";
import { useThrottledParam } from "@/lib/hooks/use-throttled-param";
import { useTrackProgress } from "@/lib/hooks/use-track-progress";
import {
  type InputStrip,
  type MediaStrip,
  type SourceStrip as SourceStripData,
  STRIP_SPEED,
  STRIP_TRIM_DB,
} from "@/lib/node-graph/schema";
import { SeekableProgress } from "../dj/deck/deck-transport";
import { ChannelSlider } from "../dj/shared/channel-slider";
import { formatPan, formatSpeed, formatTime } from "../dj/shared/format-utils";
import { PeakMeter } from "../dj/shared/peak-meter";
import { InputChannelSelect, InputLiveButton } from "./audio-input-controls";

/**
 * Source Strip
 *
 * The channel strip every Node source has, built from props so the canvas
 * node, the Rack row and the inspector share it, and so DJ's deck strip
 * renders its pan and speed knobs from the same pieces.
 *
 * - Compact (node body, Rack row): meter, M and S, and a pan knob, beside
 *   the source's own VolumeControl.
 * - Full (inspector): trim, pan, M and S and the meter for every kind; a
 *   Track or File adds speed with key lock, a seek bar, loop, cue and cue
 *   listen; a Station its buffering, stream format, bitrate and codec; an
 *   Audio input Monitor (Go live), its channels and echo cancellation.
 *
 * A kind gets only the controls it can use (`STRIP_CONTROLS`): live radio
 * can't seek, and an input has no speed, so theirs are not rendered.
 *
 * The meter taps the sound after its fader, so it follows the fader, not
 * the trim or solo, which act later on the lane's cables.
 */

export type StripKind = "station" | "platform" | "file" | "deviceIn";

export type StripControl =
  | "meter"
  | "trim"
  | "pan"
  | "mute"
  | "solo"
  | "speed"
  | "keyLock"
  | "seek"
  | "loop"
  | "cue"
  | "cueListen"
  | "buffering"
  | "format"
  | "bitrate"
  | "codec"
  | "monitor"
  | "channels"
  | "echoCancellation";

const COMMON_CONTROLS = ["meter", "trim", "pan", "mute", "solo"] as const;

const MEDIA_CONTROLS = [
  ...COMMON_CONTROLS,
  "speed",
  "keyLock",
  "seek",
  "loop",
  "cue",
  "cueListen",
] as const;

/** What each kind of source can set or show on its strip. */
export const STRIP_CONTROLS: Record<StripKind, readonly StripControl[]> = {
  deviceIn: [...COMMON_CONTROLS, "monitor", "channels", "echoCancellation"],
  file: MEDIA_CONTROLS,
  platform: MEDIA_CONTROLS,
  station: [...COMMON_CONTROLS, "buffering", "format", "bitrate", "codec"],
};

export function hasStripControl(
  kind: StripKind,
  control: StripControl
): boolean {
  return STRIP_CONTROLS[kind].includes(control);
}

const METER_HINT = "Level after the fader";
const SOLO_HINT = "Solo: only soloed sources play";
/** The meter taps before solo, so it still moves while solo silences it. */
const SOLOED_OUT_HINT = "Silenced: another source is soloed";

function formatTrim(db: number): string {
  const rounded = Math.round(db * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded} dB`;
}

/** The lane's stereo level, subscribed while shown. */
export function StripMeter({
  soundId,
  className,
  title = METER_HINT,
  soloedOut = false,
}: {
  soundId: string | null;
  className?: string;
  title?: string;
  /** Another source is soloed, so this one is silent past its meter. */
  soloedOut?: boolean;
}) {
  const level = usePeakLevel(soundId);
  return (
    <div
      aria-hidden="true"
      className={cn("min-w-0", soloedOut && "opacity-40", className)}
      data-slot="strip-meter"
      data-soloed-out={soloedOut || undefined}
      title={soloedOut ? SOLOED_OUT_HINT : title}
    >
      <PeakMeter
        compact
        left={level.left}
        orientation="horizontal"
        right={level.right}
      />
    </div>
  );
}

const STRIP_TOGGLE =
  "h-6 min-w-6 px-0 font-medium text-[11px] text-muted-foreground data-[state=on]:text-foreground";

/** M and S: the source's mute, and its solo on the lane. */
export function StripMuteSolo({
  target,
  muted,
  solo,
  soloedOut = false,
  onToggleMute,
  onToggleSolo,
}: {
  target: string;
  muted: boolean;
  solo: boolean;
  /** Another source is soloed: this S shows it's silenced, unpressed. */
  soloedOut?: boolean;
  onToggleMute: () => void;
  onToggleSolo: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Toggle
        // "channel", so it reads apart from the fader's own Mute beside it.
        aria-label={`Mute channel ${target}`}
        className={cn(STRIP_TOGGLE, "data-[state=on]:bg-destructive/15")}
        onPressedChange={onToggleMute}
        pressed={muted}
        size="sm"
        title="Mute"
      >
        M
      </Toggle>
      <Toggle
        aria-label={`Solo ${target}`}
        className={cn(
          STRIP_TOGGLE,
          "data-[state=on]:bg-amber-500/20",
          soloedOut && "ring-1 ring-amber-500/40 ring-inset"
        )}
        data-soloed-out={soloedOut || undefined}
        onPressedChange={onToggleSolo}
        pressed={solo}
        size="sm"
        title={soloedOut ? SOLOED_OUT_HINT : SOLO_HINT}
      >
        S
      </Toggle>
    </div>
  );
}

type KnobProps = {
  value: number;
  onChange: (value: number) => void;
  /** Visible caption: DJ's "PAN", the inspector's "Pan". */
  label: string;
  ariaLabel: string;
  /** A MIDI-learnable target, as DJ's deck knobs have. */
  targetId?: string;
};

/** Pan, -1 (left) to 1 (right), centred by a double-click. */
export function StripPanKnob(props: KnobProps) {
  return (
    <ChannelSlider
      defaultValue={0}
      fillFromDefault
      formatValue={formatPan}
      max={1}
      min={-1}
      step={0.01}
      {...props}
    />
  );
}

/** Speed on a log scale, 1x at the centre, as the engine clamps it. */
export function StripSpeedKnob(props: KnobProps) {
  return (
    <ChannelSlider
      defaultValue={1}
      fillFromDefault
      formatValue={formatSpeed}
      max={STRIP_SPEED.max}
      min={STRIP_SPEED.min}
      scale="log"
      step={0.01}
      {...props}
    />
  );
}

export type CompactSourceStripProps = {
  /** What the controls name, e.g. the station. */
  target: string;
  soundId: string | null;
  muted: boolean;
  solo: boolean;
  /** Another source is soloed, so this one is silenced. */
  soloedOut?: boolean;
  pan: number;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onPanChange: (pan: number) => void;
  className?: string;
};

/** The strip under a source's play and volume: meter, M and S, pan. */
export function CompactSourceStrip({
  target,
  soundId,
  muted,
  solo,
  soloedOut = false,
  pan,
  onToggleMute,
  onToggleSolo,
  onPanChange,
  className,
}: CompactSourceStripProps) {
  const throttledPan = useThrottledParam(onPanChange);
  return (
    <div
      className={cn("flex min-w-0 items-center gap-1.5", className)}
      data-slot="compact-source-strip"
    >
      <StripMeter className="flex-1" soloedOut={soloedOut} soundId={soundId} />
      <StripMuteSolo
        muted={muted}
        onToggleMute={onToggleMute}
        onToggleSolo={onToggleSolo}
        solo={solo}
        soloedOut={soloedOut}
        target={target}
      />
      <Knob
        ariaLabel={`Pan ${target}`}
        bipolar
        className="w-auto flex-row gap-1 [&>span:last-child]:w-7 [&>span:last-child]:text-left"
        defaultValue={0}
        format={formatPan}
        max={1}
        min={-1}
        onChange={throttledPan}
        size={20}
        step={0.01}
        title={`Pan: ${formatPan(pan)}`}
        value={pan}
      />
    </div>
  );
}

/** One label and value of a Station's stream details. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate tabular-nums">{value}</dd>
    </div>
  );
}

export type StationDetails = {
  isPlaying: boolean;
  isBuffering: boolean;
  format: "hls" | "progressive";
  /** kbps, from now playing, else from Radio Browser; null when unknown. */
  bitrate: number | null;
  /** Radio Browser's codec, when it listed one. */
  codec: string | null;
};

function bufferingState({ isBuffering, isPlaying }: StationDetails): string {
  if (!isPlaying) {
    return "Stopped";
  }
  return isBuffering ? "Buffering…" : "Steady";
}

/** A live Station's read-only stream details. */
function StationDetailList({ details }: { details: StationDetails }) {
  return (
    <dl className="flex flex-col gap-1" data-slot="station-details">
      <Detail label="Stream" value={bufferingState(details)} />
      <Detail
        label="Format"
        value={details.format === "hls" ? "HLS" : "Progressive"}
      />
      {details.bitrate ? (
        <Detail label="Bitrate" value={`${details.bitrate} kbps`} />
      ) : null}
      {details.codec ? <Detail label="Codec" value={details.codec} /> : null}
    </dl>
  );
}

export type MediaTransportProps = {
  soundId: string | null;
  strip: MediaStrip;
  /** A cue output is set and the browser can route to it. */
  canCueListen: boolean;
  onSeek: (position: number) => void;
  onSetCue: () => void;
  onJumpToCue: () => void;
};

/** A Track's or File's seek bar, loop, cue and cue listen. */
function MediaTransport({
  target,
  soundId,
  strip,
  canCueListen,
  onSeek,
  onSetCue,
  onJumpToCue,
  onStripChange,
}: MediaTransportProps & {
  target: string;
  onStripChange: (patch: Partial<MediaStrip>) => void;
}) {
  const progress = useTrackProgress(soundId);
  const seekable = Number.isFinite(progress.duration) && progress.duration > 0;
  return (
    <div className="flex flex-col gap-2" data-slot="media-transport">
      {seekable ? (
        <SeekableProgress
          duration={progress.duration}
          onSeek={onSeek}
          position={progress.position}
        />
      ) : (
        <p className="text-muted-foreground text-xs">
          Play it to seek and set a cue
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Toggle
          aria-label={`Loop ${target}`}
          className="h-7 gap-1 px-2 text-xs"
          onPressedChange={(loop) => onStripChange({ loop })}
          pressed={strip.loop}
          size="sm"
          title="Loop: repeat the whole track at its end"
          variant="outline"
        >
          <Repeat1Icon className="size-3.5" />
          Loop
        </Toggle>
        <Button
          className="h-7 gap-1 px-2 text-xs"
          disabled={!seekable}
          onClick={onSetCue}
          size="sm"
          title="Set the cue point here"
          variant="outline"
        >
          <MapPinIcon className="size-3.5" />
          Set cue
        </Button>
        <Button
          aria-label={
            strip.cue === null ? "Cue" : `Cue: jump to ${formatTime(strip.cue)}`
          }
          className="h-7 gap-1 px-2 text-xs"
          disabled={strip.cue === null || !seekable}
          onClick={onJumpToCue}
          size="sm"
          title={strip.cue === null ? "Set a cue first" : "Jump to the cue"}
          variant="outline"
        >
          <SkipBackIcon className="size-3.5" />
          Cue
          {strip.cue === null ? null : (
            <span className="text-muted-foreground tabular-nums">
              {formatTime(strip.cue)}
            </span>
          )}
        </Button>
        {canCueListen ? (
          <Toggle
            aria-label={`Cue listen ${target}`}
            className="h-7 gap-1 px-2 text-xs"
            onPressedChange={(cueListen) => onStripChange({ cueListen })}
            pressed={strip.cueListen}
            size="sm"
            title="Hear it pre-fader on the cue output"
            variant="outline"
          >
            <HeadphonesIcon className="size-3.5" />
            Cue listen
          </Toggle>
        ) : null}
      </div>
    </div>
  );
}

export type InputControls = {
  strip: InputStrip;
  isPlaying: boolean;
  isLoading: boolean;
  canGoLive: boolean;
  onToggleLive: () => void;
  channelSelection: ChannelSelection;
  onChannelsChange: (selection: ChannelSelection) => void;
  echoCancellation: boolean;
  onEchoCancellationChange: (enabled: boolean) => void;
};

/** An Audio input's Monitor (Go live), channels and echo cancellation. */
function InputStripControls({
  target,
  input,
}: {
  target: string;
  input: InputControls;
}) {
  const echoId = useId();
  return (
    <div className="flex flex-col gap-2" data-slot="input-controls">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className="text-muted-foreground"
          title="Hear the input live through its cables"
        >
          Monitor
        </span>
        <InputLiveButton
          disabled={!(input.canGoLive || input.isPlaying)}
          isLoading={input.isLoading}
          isPlaying={input.isPlaying}
          onToggle={input.onToggleLive}
          target={target}
        />
      </div>
      <InputChannelSelect
        onChange={input.onChannelsChange}
        value={input.channelSelection}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <label
          className="text-muted-foreground"
          htmlFor={echoId}
          title="The browser's own feedback guard. It also colours music."
        >
          Echo cancellation
        </label>
        <Switch
          checked={input.echoCancellation}
          id={echoId}
          onCheckedChange={input.onEchoCancellationChange}
        />
      </div>
    </div>
  );
}

export type SourceStripProps = {
  kind: StripKind;
  target: string;
  soundId: string | null;
  strip: SourceStripData;
  muted: boolean;
  /** Another source is soloed, so this one is silenced. */
  soloedOut?: boolean;
  onToggleMute: () => void;
  /** A knob turn or toggle; the inspector takes the undo step on release. */
  onStripChange: (patch: Partial<MediaStrip & InputStrip>) => void;
  /** Set for a Track or File. */
  media?: MediaTransportProps;
  /** Set for a Station. */
  station?: StationDetails;
  /** Set for an Audio input. */
  input?: InputControls;
};

/** The full strip in the inspector: every control the kind can use. */
export function SourceStrip({
  kind,
  target,
  soundId,
  strip,
  muted,
  soloedOut = false,
  onToggleMute,
  onStripChange,
  media,
  station,
  input,
}: SourceStripProps) {
  const has = (control: StripControl) => hasStripControl(kind, control);
  const pendingChange = useRef<Partial<MediaStrip & InputStrip>>({});
  const throttledChange = useThrottledParam(
    (patch: Partial<MediaStrip & InputStrip>) => {
      pendingChange.current = {};
      onStripChange(patch);
    }
  );
  // One trailing commit keeps every changed control, not just the last one.
  const changeStrip = (patch: Partial<MediaStrip & InputStrip>) => {
    pendingChange.current = { ...pendingChange.current, ...patch };
    throttledChange(pendingChange.current);
  };
  const speed = "speed" in strip ? strip : null;
  return (
    <div className="flex flex-col gap-3" data-slot="source-strip">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-muted-foreground text-xs">
          {kind === "deviceIn" ? "Input" : "Level"}
        </span>
        <StripMeter
          className="flex-1"
          soloedOut={soloedOut}
          soundId={soundId}
          title={
            kind === "deviceIn" ? "Input level, after its fader" : METER_HINT
          }
        />
        <StripMuteSolo
          muted={muted}
          onToggleMute={onToggleMute}
          onToggleSolo={() => onStripChange({ solo: !strip.solo })}
          solo={strip.solo}
          soloedOut={soloedOut}
          target={target}
        />
      </div>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
        <ChannelSlider
          ariaLabel={`Trim ${target}`}
          defaultValue={0}
          fillFromDefault
          formatValue={formatTrim}
          label="Trim"
          max={STRIP_TRIM_DB.max}
          min={STRIP_TRIM_DB.min}
          onChange={(trimDb) => changeStrip({ trimDb })}
          step={0.5}
          value={strip.trimDb}
        />
        <StripPanKnob
          ariaLabel={`Pan ${target}`}
          label="Pan"
          onChange={(pan) => changeStrip({ pan })}
          value={strip.pan}
        />
        {speed && has("speed") ? (
          <div className="flex flex-col items-center gap-1">
            <StripSpeedKnob
              ariaLabel={`Speed ${target}`}
              label="Speed"
              onChange={(value) => changeStrip({ speed: value })}
              value={speed.speed}
            />
            <Toggle
              aria-label={`Key lock ${target}`}
              className="h-6 px-1.5 text-[10px]"
              onPressedChange={(keyLock) => onStripChange({ keyLock })}
              pressed={speed.keyLock}
              size="sm"
              title="Key lock: keep the pitch while the speed changes"
              variant="outline"
            >
              Key lock
            </Toggle>
          </div>
        ) : null}
      </div>
      {speed && media && has("seek") ? (
        <MediaTransport
          {...media}
          onStripChange={onStripChange}
          strip={speed}
          target={target}
        />
      ) : null}
      {station && has("format") ? (
        <StationDetailList details={station} />
      ) : null}
      {input && has("monitor") ? (
        <InputStripControls input={input} target={target} />
      ) : null}
    </div>
  );
}
