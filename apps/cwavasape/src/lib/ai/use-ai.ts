/**
 * React hook for AI analysis using transformer.js
 *
 * Manages worker communication, model loading state, and analysis triggers.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cacheDetections,
  cacheSegments,
  cacheText,
  getCachedAnalysis,
  getPending,
  hasAnalysis,
  isPending,
  setPending,
} from "./analysis-cache";
import type {
  AIAnalysis,
  AnalysisType,
  ModelState,
  WorkerMessage,
} from "./types";

type ModelStates = {
  detector: ModelState;
  segmenter: ModelState;
  ocr: ModelState;
};

const initialModelState: ModelState = {
  status: "idle",
  progress: 0,
};

type PendingRequest = {
  resolve: () => void;
  reject: (error: Error) => void;
};

export function useAI() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef<Map<string, PendingRequest>>(new Map());
  const requestCounter = useRef(0);

  const [modelStates, setModelStates] = useState<ModelStates>({
    detector: initialModelState,
    segmenter: initialModelState,
    ocr: initialModelState,
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  /**
   * Get or create the AI worker
   */
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("./ai-worker.ts", import.meta.url),
        { type: "module" }
      );

      workerRef.current.addEventListener(
        "message",
        (e: MessageEvent<WorkerMessage>) => {
          const msg = e.data;

          switch (msg.type) {
            case "progress": {
              setModelStates((prev) => ({
                ...prev,
                [msg.model]: {
                  status: "loading",
                  progress: msg.progress,
                },
              }));
              break;
            }

            case "model-ready": {
              setModelStates((prev) => ({
                ...prev,
                [msg.model]: {
                  status: "ready",
                  progress: 100,
                },
              }));
              break;
            }

            case "detect-result": {
              const pending = pendingRequests.current.get(msg.id);
              if (pending) {
                // Cache is updated by the analyze function via imageUrl tracking
                pending.resolve();
                pendingRequests.current.delete(msg.id);
              }
              break;
            }

            case "segment-result": {
              const pending = pendingRequests.current.get(msg.id);
              if (pending) {
                pending.resolve();
                pendingRequests.current.delete(msg.id);
              }
              break;
            }

            case "ocr-result": {
              const pending = pendingRequests.current.get(msg.id);
              if (pending) {
                pending.resolve();
                pendingRequests.current.delete(msg.id);
              }
              break;
            }

            case "error": {
              const pending = pendingRequests.current.get(msg.id);
              if (pending) {
                pending.reject(new Error(msg.error));
                pendingRequests.current.delete(msg.id);
              }
              break;
            }

            default:
              // Unknown message type - ignore
              break;
          }
        }
      );

      // Handle worker errors
      workerRef.current.addEventListener("error", (e) => {
        console.error("AI Worker error:", e.message);
        // Reject all pending requests
        for (const [id, pending] of pendingRequests.current) {
          pending.reject(new Error(`Worker error: ${e.message}`));
          pendingRequests.current.delete(id);
        }
      });
    }

    return workerRef.current;
  }, []);

  /**
   * Generate unique request ID
   */
  const generateId = useCallback(() => {
    return `req-${++requestCounter.current}-${Date.now()}`;
  }, []);

  /**
   * Run detection on an image
   */
  const detect = useCallback(
    (imageUrl: string, threshold = 0.5): Promise<void> => {
      const worker = getWorker();
      const id = generateId();

      return new Promise((resolve, reject) => {
        pendingRequests.current.set(id, {
          resolve: () => {
            // Worker will send results which we need to cache
            resolve();
          },
          reject,
        });

        // Set up one-time listener for this specific request
        const handleResult = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === "detect-result" && e.data.id === id) {
            cacheDetections(imageUrl, e.data.detections);
            worker.removeEventListener("message", handleResult);
          }
        };
        worker.addEventListener("message", handleResult);

        worker.postMessage({ type: "detect", id, imageUrl, threshold });
      });
    },
    [getWorker, generateId]
  );

  /**
   * Run segmentation on an image
   */
  const segment = useCallback(
    (imageUrl: string): Promise<void> => {
      const worker = getWorker();
      const id = generateId();

      return new Promise((resolve, reject) => {
        pendingRequests.current.set(id, { resolve, reject });

        const handleResult = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === "segment-result" && e.data.id === id) {
            cacheSegments(imageUrl, e.data.segments);
            worker.removeEventListener("message", handleResult);
          }
        };
        worker.addEventListener("message", handleResult);

        worker.postMessage({ type: "segment", id, imageUrl });
      });
    },
    [getWorker, generateId]
  );

  /**
   * Run OCR on an image
   */
  const ocr = useCallback(
    (imageUrl: string): Promise<void> => {
      const worker = getWorker();
      const id = generateId();

      return new Promise((resolve, reject) => {
        pendingRequests.current.set(id, { resolve, reject });

        const handleResult = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === "ocr-result" && e.data.id === id) {
            cacheText(imageUrl, e.data.text);
            worker.removeEventListener("message", handleResult);
          }
        };
        worker.addEventListener("message", handleResult);

        worker.postMessage({ type: "ocr", id, imageUrl });
      });
    },
    [getWorker, generateId]
  );

  /**
   * Analyze an image with specified analysis types
   */
  const analyze = useCallback(
    async (
      imageUrl: string,
      types: AnalysisType[],
      options?: { detectionThreshold?: number }
    ): Promise<AIAnalysis | undefined> => {
      // Check if already analyzed
      if (hasAnalysis(imageUrl)) {
        return getCachedAnalysis(imageUrl);
      }

      // Check if already pending
      if (isPending(imageUrl)) {
        await getPending(imageUrl);
        return getCachedAnalysis(imageUrl);
      }

      setIsAnalyzing(true);

      const analysisPromise = (async () => {
        const promises: Promise<void>[] = [];

        if (types.includes("detect")) {
          promises.push(detect(imageUrl, options?.detectionThreshold));
        }
        if (types.includes("segment")) {
          promises.push(segment(imageUrl));
        }
        if (types.includes("ocr")) {
          promises.push(ocr(imageUrl));
        }

        await Promise.all(promises);
      })();

      setPending(imageUrl, analysisPromise);

      try {
        await analysisPromise;
        return getCachedAnalysis(imageUrl);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("AI analysis failed:", error);
        }
        return undefined;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [detect, segment, ocr]
  );

  /**
   * Preload a model without running analysis
   */
  const preloadModel = useCallback(
    (model: "detector" | "segmenter" | "ocr") => {
      const worker = getWorker();
      worker.postMessage({ type: "init", id: "preload", imageUrl: model });
    },
    [getWorker]
  );

  /**
   * Get cached analysis for an image
   */
  const getAnalysis = useCallback(
    (imageUrl: string): AIAnalysis | undefined => {
      return getCachedAnalysis(imageUrl);
    },
    []
  );

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      pendingRequests.current.clear();
    };
  }, []);

  return {
    analyze,
    getAnalysis,
    preloadModel,
    modelStates,
    isAnalyzing,
  };
}
