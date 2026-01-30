/**
 * Cache for AI analysis results
 *
 * Separate from the math-based feature cache to allow independent lifecycle.
 */

import type { AIAnalysis, DetectedObject, SegmentMask } from "./types";

/**
 * Cache for AI analysis results, keyed by image URL
 */
const analysisCache = new Map<string, AIAnalysis>();

/**
 * Pending analysis requests to prevent duplicate work
 */
const pendingAnalysis = new Map<string, Promise<void>>();

/**
 * Get cached analysis for an image
 */
export function getCachedAnalysis(imageUrl: string): AIAnalysis | undefined {
  return analysisCache.get(imageUrl);
}

/**
 * Check if analysis is cached for an image
 */
export function hasAnalysis(imageUrl: string): boolean {
  return analysisCache.has(imageUrl);
}

/**
 * Check if analysis is currently pending for an image
 */
export function isPending(imageUrl: string): boolean {
  return pendingAnalysis.has(imageUrl);
}

/**
 * Set pending promise for an image analysis
 */
export function setPending(imageUrl: string, promise: Promise<void>): void {
  pendingAnalysis.set(imageUrl, promise);
  promise.finally(() => {
    pendingAnalysis.delete(imageUrl);
  });
}

/**
 * Get pending promise if exists
 */
export function getPending(imageUrl: string): Promise<void> | undefined {
  return pendingAnalysis.get(imageUrl);
}

/**
 * Cache detection results for an image
 */
export function cacheDetections(
  imageUrl: string,
  detections: DetectedObject[]
): void {
  const existing = analysisCache.get(imageUrl);
  if (existing) {
    analysisCache.set(imageUrl, {
      ...existing,
      detections,
      timestamp: Date.now(),
    });
  } else {
    analysisCache.set(imageUrl, {
      detections,
      segments: null,
      text: null,
      timestamp: Date.now(),
    });
  }
}

/**
 * Cache segmentation results for an image
 */
export function cacheSegments(imageUrl: string, segments: SegmentMask[]): void {
  const existing = analysisCache.get(imageUrl);
  if (existing) {
    analysisCache.set(imageUrl, {
      ...existing,
      segments,
      timestamp: Date.now(),
    });
  } else {
    analysisCache.set(imageUrl, {
      detections: null,
      segments,
      text: null,
      timestamp: Date.now(),
    });
  }
}

/**
 * Cache OCR text for an image
 */
export function cacheText(imageUrl: string, text: string): void {
  const existing = analysisCache.get(imageUrl);
  if (existing) {
    analysisCache.set(imageUrl, {
      ...existing,
      text,
      timestamp: Date.now(),
    });
  } else {
    analysisCache.set(imageUrl, {
      detections: null,
      segments: null,
      text,
      timestamp: Date.now(),
    });
  }
}

/**
 * Clear all cached analysis
 */
export function clearAnalysisCache(): void {
  analysisCache.clear();
  pendingAnalysis.clear();
}

/**
 * Clear analysis for a specific image
 */
export function clearAnalysis(imageUrl: string): void {
  analysisCache.delete(imageUrl);
  pendingAnalysis.delete(imageUrl);
}

/**
 * Get cache size for debugging
 */
export function getCacheSize(): number {
  return analysisCache.size;
}
