/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes handlers */
/** biome-ignore-all lint/suspicious/noArrayIndexKey: points and steps are fixed indexed slots, without child state */
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Slider } from "@avoid.quest/ui/components/slider";
import { useId, useRef, useState } from "react";
import { curveAt } from "@/lib/node-graph/modulation-curve";
import type { ModulationPoint } from "@/lib/node-graph/modulation-schema";
import { ModuleKnob, ModuleSelect } from "./module-frame";

const FIELD = "w-14 rounded border bg-background px-1.5 py-1 text-xs";

export function StepsEditor({
  values,
  onChange,
}: {
  values: number[];
  onChange: (values: number[]) => void;
}) {
  const [pulses, setPulses] = useState(4);
  const fieldId = useId();
  return (
    <div className="w-full space-y-2 px-2 pb-2">
      <div className="flex items-center gap-2 text-xs">
        <label htmlFor={`${fieldId}-count`}>
          Steps{" "}
          <Input
            aria-label="Step count"
            className={FIELD}
            id={`${fieldId}-count`}
            max={64}
            min={1}
            onChange={(event) => {
              const count = Math.max(
                1,
                Math.min(64, Number(event.target.value))
              );
              onChange(
                Array.from({ length: count }, (_, index) => values[index] ?? 0)
              );
            }}
            type="number"
            value={values.length}
          />
        </label>
        <label htmlFor={`${fieldId}-pulses`}>
          Pulses{" "}
          <Input
            aria-label="Euclidean pulses"
            className={FIELD}
            id={`${fieldId}-pulses`}
            max={values.length}
            min={0}
            onChange={(event) =>
              setPulses(
                Math.max(0, Math.min(values.length, Number(event.target.value)))
              )
            }
            type="number"
            value={pulses}
          />
        </label>
        <Button
          onClick={() => {
            const count = Math.min(values.length, pulses);
            onChange(
              values.map((_, index) =>
                (index * count) % values.length < count ? 1 : 0
              )
            );
          }}
          size="sm"
          variant="outline"
        >
          Euclidean
        </Button>
      </div>
      <div className="grid grid-cols-8 gap-1">
        {values.map((value, index) => (
          <div
            className="flex flex-col gap-0.5 text-center text-[10px] text-muted-foreground"
            key={`step-${index + 1}`}
          >
            {index + 1}
            <Slider
              aria-label={`Step ${index + 1} value`}
              className="mx-auto data-[orientation=vertical]:h-12 data-[orientation=vertical]:min-h-0"
              max={1}
              min={0}
              onValueChange={([next = 0]) =>
                onChange(
                  values.map((entry, position) =>
                    position === index ? next : entry
                  )
                )
              }
              orientation="vertical"
              step={0.01}
              value={[value]}
            />
            {value.toFixed(2)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Drag points; time and bend remain reachable from keyboard controls. */
export function CurveEditor({
  points,
  fixed,
  onChange,
}: {
  points: ModulationPoint[];
  fixed: boolean;
  onChange: (points: ModulationPoint[]) => void;
}) {
  const [selected, setSelected] = useState(0);
  const dragging = useRef<number | null>(null);
  const index = Math.min(selected, points.length - 1);
  const current = points[index];
  if (!current) {
    return null;
  }
  const update = (point: Partial<ModulationPoint>) =>
    onChange(
      points.map((entry, position) =>
        position === index ? { ...entry, ...point } : entry
      )
    );
  const minTime = index === 0 ? 0 : (points[index - 1]?.time ?? 0) + 0.001;
  const maxTime =
    index === points.length - 1 ? 1 : (points[index + 1]?.time ?? 1) - 0.001;
  const path = Array.from(
    { length: 129 },
    (_, position) =>
      `${8 + (position / 128) * 272},${92 - curveAt(points, position / 128) * 84}`
  ).join(" ");
  return (
    <div className="w-full space-y-2 px-2 pb-2">
      <svg
        aria-label="Envelope curve; edit point values below"
        className="w-full touch-none rounded border bg-muted/20 text-primary"
        onLostPointerCapture={() => {
          dragging.current = null;
        }}
        onPointerDown={(event) => {
          const point = (event.target as SVGElement).getAttribute("data-point");
          if (point === null) {
            return;
          }
          dragging.current = Number(point);
          setSelected(Number(point));
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = dragging.current;
          if (active === null) {
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          const value = Math.max(
            0,
            Math.min(
              1,
              (92 - ((event.clientY - bounds.top) / bounds.height) * 100) / 84
            )
          );
          const low = (points[active - 1]?.time ?? 0) + 0.001;
          const high = (points[active + 1]?.time ?? 1) - 0.001;
          let time = Math.max(
            low,
            Math.min(
              high,
              (((event.clientX - bounds.left) / bounds.width) * 288 - 8) / 272
            )
          );
          if (active === 0) {
            time = 0;
          } else if (active === points.length - 1) {
            time = 1;
          }
          onChange(
            points.map((entry, position) =>
              position === active ? { ...entry, time, value } : entry
            )
          );
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        role="img"
        viewBox="0 0 288 100"
      >
        <title>Modulation curve</title>
        <path d="M8 50H280 M144 8V92" opacity={0.15} stroke="currentColor" />
        <polyline
          fill="none"
          points={path}
          stroke="currentColor"
          strokeWidth={2}
        />
        {points.map((point, position) => (
          <circle
            className="cursor-grab"
            cx={8 + point.time * 272}
            cy={92 - point.value * 84}
            data-point={position}
            fill="currentColor"
            key={`point-${position + 1}`}
            opacity={position === index ? 1 : 0.6}
            r={5}
          />
        ))}
      </svg>
      <div className="flex flex-wrap items-start gap-2">
        <ModuleSelect
          label="Point"
          name="Curve point"
          onChange={(value) => setSelected(Number(value))}
          options={points.map((_, position) => ({
            label: String(position + 1),
            value: String(position),
          }))}
          value={String(index)}
        />
        {index > 0 && index < points.length - 1 ? (
          <ModuleKnob
            format={(value) => `${Math.round(value * 100)}%`}
            label="Time"
            max={maxTime}
            min={minTime}
            name="Point time"
            onChange={(time) => update({ time })}
            step={0.001}
            value={current.time}
          />
        ) : null}
        <ModuleKnob
          format={(value) => value.toFixed(2)}
          label="Value"
          max={1}
          min={0}
          name="Point value"
          onChange={(value) => update({ value })}
          step={0.01}
          value={current.value}
        />
        <ModuleKnob
          format={(value) => value.toFixed(2)}
          label="Bend"
          max={1}
          min={-1}
          name="Point bend"
          onChange={(bend) => update({ bend })}
          step={0.01}
          value={current.bend}
        />
      </div>
      {fixed ? (
        <p className="text-[10px] text-muted-foreground">
          Hold point is 0–6; −1 plays all eight stages once.
        </p>
      ) : (
        <div className="flex gap-2">
          <Button
            disabled={points.length >= 16}
            onClick={() => {
              let gap = 1;
              for (let position = 2; position < points.length; position += 1) {
                if (
                  (points[position]?.time ?? 0) -
                    (points[position - 1]?.time ?? 0) >
                  (points[gap]?.time ?? 0) - (points[gap - 1]?.time ?? 0)
                ) {
                  gap = position;
                }
              }
              const time =
                ((points[gap - 1]?.time ?? 0) + (points[gap]?.time ?? 1)) / 2;
              onChange([
                ...points.slice(0, gap),
                { bend: 0, time, value: curveAt(points, time) },
                ...points.slice(gap),
              ]);
              setSelected(gap);
            }}
            size="sm"
            variant="outline"
          >
            Add point
          </Button>
          <Button
            disabled={index === 0 || index === points.length - 1}
            onClick={() => {
              onChange(points.filter((_, position) => position !== index));
              setSelected(Math.max(0, index - 1));
            }}
            size="sm"
            variant="outline"
          >
            Remove point
          </Button>
        </div>
      )}
    </div>
  );
}
