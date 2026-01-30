/**
 * AI Analysis Types for transformer.js integration
 */

/**
 * Bounding box coordinates (normalized 0-1)
 */
export type BoundingBox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

/**
 * Object detected in an image
 */
export type DetectedObject = {
  label: string;
  score: number;
  box: BoundingBox;
};

/**
 * Segmentation mask for an object
 */
export type SegmentMask = {
  label: string;
  score: number;
  maskData: Uint8Array;
  width: number;
  height: number;
};

/**
 * Complete AI analysis result for an image
 */
export type AIAnalysis = {
  detections: DetectedObject[] | null;
  segments: SegmentMask[] | null;
  text: string | null;
  timestamp: number;
};

/**
 * Model loading states
 */
export type ModelStatus = "idle" | "loading" | "ready" | "error";

export type ModelState = {
  status: ModelStatus;
  progress: number;
  error?: string;
};

/**
 * Worker message types
 */
export type WorkerRequestType = "detect" | "segment" | "ocr" | "init";

export type WorkerRequest = {
  id: string;
  type: WorkerRequestType;
  imageUrl: string;
};

export type WorkerProgressMessage = {
  type: "progress";
  model: "detector" | "segmenter" | "ocr";
  progress: number;
};

export type WorkerDetectResultMessage = {
  type: "detect-result";
  id: string;
  detections: DetectedObject[];
};

export type WorkerSegmentResultMessage = {
  type: "segment-result";
  id: string;
  segments: SegmentMask[];
};

export type WorkerOCRResultMessage = {
  type: "ocr-result";
  id: string;
  text: string;
};

export type WorkerErrorMessage = {
  type: "error";
  id: string;
  error: string;
};

export type WorkerModelReadyMessage = {
  type: "model-ready";
  model: "detector" | "segmenter" | "ocr";
};

export type WorkerMessage =
  | WorkerProgressMessage
  | WorkerDetectResultMessage
  | WorkerSegmentResultMessage
  | WorkerOCRResultMessage
  | WorkerErrorMessage
  | WorkerModelReadyMessage;

/**
 * Analysis types that can be requested
 */
export type AnalysisType = "detect" | "segment" | "ocr";
