import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PeakMeter } from "./peak-meter";

describe("PeakMeter", () => {
  test("renders compact horizontal layout with reduced bar size", () => {
    const compactHtml = renderToStaticMarkup(
      <PeakMeter compact={true} left={0.8} orientation="horizontal" right={0.6} />
    );

    expect(compactHtml.includes("w-full flex-col gap-px")).toBeTrue();
    expect(compactHtml.includes("h-1 w-full")).toBeTrue();
    expect(compactHtml.includes("h-1.5 w-full")).toBeFalse();
  });

  test("renders default horizontal layout with standard bar size", () => {
    const defaultHtml = renderToStaticMarkup(
      <PeakMeter left={0.8} orientation="horizontal" right={0.6} />
    );

    expect(defaultHtml.includes("w-full flex-col gap-0.5")).toBeTrue();
    expect(defaultHtml.includes("h-1.5 w-full")).toBeTrue();
  });
});
