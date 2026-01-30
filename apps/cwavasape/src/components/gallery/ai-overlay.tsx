/**
 * AI Analysis Overlay Component
 *
 * Renders detection boxes, segmentation masks, and OCR text
 * as DOM elements overlaid on the effects canvas.
 */

import { memo, useMemo } from "react";
import type { AIAnalysis, DetectedObject, SegmentMask } from "@/lib/ai/types";
import type { AISettings } from "@/lib/collections/settings";

type AIOverlayProps = {
  analysis: AIAnalysis | undefined;
  settings: AISettings | undefined;
  imageWidth: number;
  imageHeight: number;
  imageX: number;
  imageY: number;
};

/**
 * Get color for detection box based on label
 */
function getLabelColor(label: string): string {
  // Simple hash function for consistent colors
  let hash = 0;
  for (const char of label) {
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional hash function
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Detection bounding box component
 */
const DetectionBox = memo(function DetectionBox({
  detection,
  imageWidth,
  imageHeight,
  imageX,
  imageY,
}: {
  detection: DetectedObject;
  imageWidth: number;
  imageHeight: number;
  imageX: number;
  imageY: number;
}) {
  const { label, score, box } = detection;
  const color = getLabelColor(label);

  // Convert normalized coordinates to pixels
  const left = imageX + box.xmin * imageWidth;
  const top = imageY + box.ymin * imageHeight;
  const width = (box.xmax - box.xmin) * imageWidth;
  const height = (box.ymax - box.ymin) * imageHeight;

  return (
    <div
      className="absolute rounded-sm border-2"
      style={{
        left,
        top,
        width,
        height,
        borderColor: color,
      }}
    >
      <div
        className="absolute -top-6 left-0 whitespace-nowrap rounded-t-sm px-1.5 py-0.5 font-medium text-white text-xs"
        style={{ backgroundColor: color }}
      >
        {label} {(score * 100).toFixed(0)}%
      </div>
    </div>
  );
});

/**
 * Segmentation mask overlay
 * Renders masks as semi-transparent colored regions
 */
const SegmentationOverlay = memo(function SegmentationOverlay({
  segments,
  imageWidth,
  imageHeight,
  imageX,
  imageY,
}: {
  segments: SegmentMask[];
  imageWidth: number;
  imageHeight: number;
  imageX: number;
  imageY: number;
}) {
  // Create canvas with segmentation masks
  const canvasDataUrl = useMemo(() => {
    if (segments.length === 0) {
      return null;
    }

    // Use the dimensions from the first segment
    const maskWidth = segments[0].width;
    const maskHeight = segments[0].height;

    const canvas = document.createElement("canvas");
    canvas.width = maskWidth;
    canvas.height = maskHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    // Render each segment with a unique color
    for (const segment of segments) {
      const color = getLabelColor(segment.label);
      const imageData = ctx.createImageData(maskWidth, maskHeight);

      // Parse HSL color to RGB
      const tempDiv = document.createElement("div");
      tempDiv.style.color = color;
      document.body.appendChild(tempDiv);
      const rgbMatch = getComputedStyle(tempDiv).color.match(/\d+/g);
      document.body.removeChild(tempDiv);

      const r = rgbMatch ? Number.parseInt(rgbMatch[0], 10) : 128;
      const g = rgbMatch ? Number.parseInt(rgbMatch[1], 10) : 128;
      const b = rgbMatch ? Number.parseInt(rgbMatch[2], 10) : 128;

      // Apply mask data
      for (let i = 0; i < segment.maskData.length; i++) {
        const pixelIndex = i * 4;
        if (segment.maskData[i] > 0) {
          imageData.data[pixelIndex] = r;
          imageData.data[pixelIndex + 1] = g;
          imageData.data[pixelIndex + 2] = b;
          imageData.data[pixelIndex + 3] = 100; // Semi-transparent
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }

    return canvas.toDataURL();
  }, [segments]);

  if (!canvasDataUrl) {
    return null;
  }

  return (
    <img
      alt=""
      className="absolute"
      height={imageHeight}
      src={canvasDataUrl}
      style={{
        left: imageX,
        top: imageY,
        width: imageWidth,
        height: imageHeight,
      }}
      width={imageWidth}
    />
  );
});

/**
 * OCR text overlay
 * Shows extracted text in a floating panel
 */
const TextOverlay = memo(function TextOverlay({ text }: { text: string }) {
  if (!text.trim()) {
    return null;
  }

  return (
    <div className="absolute right-4 bottom-4 left-4 max-h-32 overflow-y-auto rounded-lg bg-black/80 p-3 text-sm text-white backdrop-blur">
      <div className="mb-1 text-gray-400 text-xs">Detected Text:</div>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
});

/**
 * Main AI Overlay component
 */
export const AIOverlay = memo(function AIOverlay({
  analysis,
  settings,
  imageWidth,
  imageHeight,
  imageX,
  imageY,
}: AIOverlayProps) {
  // Don't render if AI is disabled or no analysis
  if (!(settings?.enabled && analysis)) {
    return null;
  }

  const showDetections =
    settings.detection.enabled &&
    settings.detection.showOverlay &&
    analysis.detections?.length;

  const showSegmentation =
    settings.segmentation.enabled &&
    settings.segmentation.showOverlay &&
    analysis.segments?.length;

  const showText =
    settings.ocr.enabled && settings.ocr.showOverlay && analysis.text;

  // Nothing to show
  if (!(showDetections || showSegmentation || showText)) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {/* Segmentation masks (rendered first, behind boxes) */}
      {showSegmentation && analysis.segments && (
        <SegmentationOverlay
          imageHeight={imageHeight}
          imageWidth={imageWidth}
          imageX={imageX}
          imageY={imageY}
          segments={analysis.segments}
        />
      )}

      {/* Detection bounding boxes */}
      {showDetections &&
        analysis.detections
          ?.filter((d) => d.score >= (settings.detection.threshold ?? 0.5))
          .map((detection, index) => (
            <DetectionBox
              detection={detection}
              imageHeight={imageHeight}
              imageWidth={imageWidth}
              imageX={imageX}
              imageY={imageY}
              key={`${detection.label}-${index}`}
            />
          ))}

      {/* OCR text panel */}
      {showText && analysis.text && <TextOverlay text={analysis.text} />}
    </div>
  );
});
