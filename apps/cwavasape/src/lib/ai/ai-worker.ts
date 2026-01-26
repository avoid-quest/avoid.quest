/**
 * AI Analysis Web Worker using transformer.js
 *
 * Performs object detection, segmentation, and OCR in a separate thread.
 * Models are loaded lazily on first use with progress callbacks.
 */

import { env, pipeline } from "@huggingface/transformers";
import type { DetectedObject, SegmentMask, WorkerRequest } from "./types";

// Configure transformer.js to use CDN for models
env.allowLocalModels = false;

// Pipeline type - using a more flexible type to avoid complex inference
type Pipeline = (
  input: string,
  options?: Record<string, unknown>
) => Promise<unknown>;

// Type for the detector pipeline result
type DetectorResult = {
  label: string;
  score: number;
  box: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
};

// Type for segmentation result
type SegmentResult = {
  label: string;
  score: number;
  mask: {
    data: Uint8Array;
    width: number;
    height: number;
  };
};

// Type for OCR result
type OCRResult = {
  generated_text: string;
};

// Singleton pipelines (lazy loaded)
let detector: Pipeline | null = null;
let segmenter: Pipeline | null = null;
let ocrPipeline: Pipeline | null = null;

// Track loading state to prevent duplicate loads
let detectorLoading = false;
let segmenterLoading = false;
let ocrLoading = false;

/**
 * Post progress message to main thread
 */
function postProgress(
  model: "detector" | "segmenter" | "ocr",
  progress: number
): void {
  self.postMessage({ type: "progress", model, progress });
}

/**
 * Progress callback handler
 */
function createProgressCallback(model: "detector" | "segmenter" | "ocr") {
  return (progressInfo: { progress?: number; status?: string }) => {
    if (typeof progressInfo.progress === "number") {
      postProgress(model, progressInfo.progress);
    }
  };
}

/**
 * Get or load the object detection model
 */
async function getDetector(): Promise<Pipeline> {
  if (detector) {
    return detector;
  }
  if (detectorLoading) {
    // Wait for existing load
    while (detectorLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (detector) {
      return detector;
    }
  }

  detectorLoading = true;
  try {
    const pipe = await pipeline("object-detection", "Xenova/detr-resnet-50", {
      progress_callback: createProgressCallback("detector"),
      dtype: "fp32", // Explicitly set dtype to avoid warning
    });
    detector = pipe as unknown as Pipeline;
    self.postMessage({ type: "model-ready", model: "detector" });
    return detector;
  } finally {
    detectorLoading = false;
  }
}

/**
 * Get or load the segmentation model
 */
async function getSegmenter(): Promise<Pipeline> {
  if (segmenter) {
    return segmenter;
  }
  if (segmenterLoading) {
    while (segmenterLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (segmenter) {
      return segmenter;
    }
  }

  segmenterLoading = true;
  try {
    const pipe = await pipeline(
      "image-segmentation",
      "Xenova/segformer-b0-finetuned-ade-512-512",
      {
        progress_callback: createProgressCallback("segmenter"),
        dtype: "fp32",
      }
    );
    segmenter = pipe as unknown as Pipeline;
    self.postMessage({ type: "model-ready", model: "segmenter" });
    return segmenter;
  } finally {
    segmenterLoading = false;
  }
}

/**
 * Get or load the OCR model
 */
async function getOCR(): Promise<Pipeline> {
  if (ocrPipeline) {
    return ocrPipeline;
  }
  if (ocrLoading) {
    while (ocrLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (ocrPipeline) {
      return ocrPipeline;
    }
  }

  ocrLoading = true;
  try {
    const pipe = await pipeline("image-to-text", "Xenova/trocr-small-printed", {
      progress_callback: createProgressCallback("ocr"),
      dtype: "fp32",
    });
    ocrPipeline = pipe as unknown as Pipeline;
    self.postMessage({ type: "model-ready", model: "ocr" });
    return ocrPipeline;
  } finally {
    ocrLoading = false;
  }
}

/**
 * Run object detection on an image
 */
async function runDetection(
  imageUrl: string,
  threshold: number
): Promise<DetectedObject[]> {
  const det = await getDetector();
  const results = (await det(imageUrl, {
    threshold,
    percentage: true,
  })) as DetectorResult[];

  return results.map((r) => ({
    label: r.label,
    score: r.score,
    box: {
      xmin: r.box.xmin,
      ymin: r.box.ymin,
      xmax: r.box.xmax,
      ymax: r.box.ymax,
    },
  }));
}

/**
 * Run segmentation on an image
 */
async function runSegmentation(imageUrl: string): Promise<SegmentMask[]> {
  const seg = await getSegmenter();
  const results = (await seg(imageUrl)) as SegmentResult[];

  return results.map((r) => ({
    label: r.label,
    score: r.score,
    maskData: r.mask.data,
    width: r.mask.width,
    height: r.mask.height,
  }));
}

/**
 * Run OCR on an image
 */
async function runOCR(imageUrl: string): Promise<string> {
  const ocr = await getOCR();
  const results = (await ocr(imageUrl)) as OCRResult[];

  return results.map((r) => r.generated_text).join(" ");
}

// Handle messages from main thread
self.addEventListener(
  "message",
  async (e: MessageEvent<WorkerRequest & { threshold?: number }>) => {
    const { id, type, imageUrl, threshold = 0.5 } = e.data;

    try {
      switch (type) {
        case "detect": {
          const detections = await runDetection(imageUrl, threshold);
          self.postMessage({ type: "detect-result", id, detections });
          break;
        }
        case "segment": {
          const segments = await runSegmentation(imageUrl);
          self.postMessage({ type: "segment-result", id, segments });
          break;
        }
        case "ocr": {
          const text = await runOCR(imageUrl);
          self.postMessage({ type: "ocr-result", id, text });
          break;
        }
        case "init": {
          // Preload models in background
          // Don't await - let them load in parallel
          if (e.data.imageUrl === "detector") {
            getDetector();
          }
          if (e.data.imageUrl === "segmenter") {
            getSegmenter();
          }
          if (e.data.imageUrl === "ocr") {
            getOCR();
          }
          break;
        }
        default:
          // Unknown message type - ignore
          break;
      }
    } catch (error) {
      self.postMessage({
        type: "error",
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);
