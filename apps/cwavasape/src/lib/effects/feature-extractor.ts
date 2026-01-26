import type { Application, Texture } from "pixi.js";
import type { ImageFeatures, RGBColor } from "./feature-types";

const SAMPLE_SIZE = 64;

/**
 * Cache for extracted features by image URL
 */
const featureCache = new Map<string, ImageFeatures>();

/**
 * Extract features from a texture for smart transitions
 */
export function extractFeatures(
  app: Application,
  texture: Texture,
  cacheKey?: string
): ImageFeatures {
  // Check cache first
  if (cacheKey) {
    const cached = featureCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Extract pixel data from texture
  const pixels = extractPixelData(app, texture);

  // Compute all features
  const features: ImageFeatures = {
    dominantColors: computeDominantColors(pixels),
    edgeDensity: computeEdgeDensity(pixels),
    centerOfMass: computeCenterOfMass(pixels),
    sharpness: computeSharpness(pixels),
    luminanceHistogram: computeLuminanceHistogram(pixels),
    averageLuminance: computeAverageLuminance(pixels),
    dominantHue: computeDominantHue(pixels),
  };

  // Cache the result
  if (cacheKey) {
    featureCache.set(cacheKey, features);
  }

  return features;
}

/**
 * Clear the feature cache
 */
export function clearFeatureCache(): void {
  featureCache.clear();
}

/**
 * Extract pixel data from texture as RGBA array
 */
function extractPixelData(
  app: Application,
  texture: Texture
): Uint8ClampedArray {
  // Create a canvas to render the texture at sample size
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get 2D context");
  }

  // Extract the texture to a canvas using PixiJS
  // The ICanvas type from PixiJS is compatible with HTMLCanvasElement at runtime
  const extractedCanvas = app.renderer.extract.canvas(
    texture
  ) as unknown as HTMLCanvasElement;

  // Draw to our sample-sized canvas
  ctx.drawImage(extractedCanvas, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  // Get pixel data
  const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return imageData.data;
}

/**
 * Compute luminance from RGB values
 */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Compute dominant colors using simplified k-means clustering
 */
function computeDominantColors(
  pixels: Uint8ClampedArray
): [RGBColor, RGBColor, RGBColor] {
  const K = 3;
  const colors: RGBColor[] = [];

  // Sample pixels (every 4th pixel for speed)
  for (let i = 0; i < pixels.length; i += 16) {
    colors.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }

  // Initialize centroids from sampled colors
  const centroids: [RGBColor, RGBColor, RGBColor] = [
    colors[0] ?? [128, 128, 128],
    colors[Math.floor(colors.length / 3)] ?? [128, 128, 128],
    colors[Math.floor((colors.length * 2) / 3)] ?? [128, 128, 128],
  ];

  // Run k-means for a few iterations
  for (let iter = 0; iter < 10; iter++) {
    const clusters: RGBColor[][] = [[], [], []];

    // Assign colors to nearest centroid
    for (const color of colors) {
      let minDist = Number.POSITIVE_INFINITY;
      let minIdx = 0;
      for (let k = 0; k < K; k++) {
        const dist = colorDistance(color, centroids[k]);
        if (dist < minDist) {
          minDist = dist;
          minIdx = k;
        }
      }
      clusters[minIdx].push(color);
    }

    // Update centroids
    for (let k = 0; k < K; k++) {
      if (clusters[k].length > 0) {
        centroids[k] = averageColor(clusters[k]);
      }
    }
  }

  // Return centroids (most dominant first based on k-means)
  return centroids;
}

function colorDistance(a: RGBColor, b: RGBColor): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function averageColor(colors: RGBColor[]): RGBColor {
  let r = 0,
    g = 0,
    b = 0;
  for (const c of colors) {
    r += c[0];
    g += c[1];
    b += c[2];
  }
  const n = colors.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Compute edge density using Sobel-like operator
 */
function computeEdgeDensity(pixels: Uint8ClampedArray): number {
  const width = SAMPLE_SIZE;
  const height = SAMPLE_SIZE;
  let totalEdge = 0;

  const getLum = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
  };

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // Sobel gradients
      const gx =
        -getLum(x - 1, y - 1) -
        2 * getLum(x - 1, y) -
        getLum(x - 1, y + 1) +
        getLum(x + 1, y - 1) +
        2 * getLum(x + 1, y) +
        getLum(x + 1, y + 1);

      const gy =
        -getLum(x - 1, y - 1) -
        2 * getLum(x, y - 1) -
        getLum(x + 1, y - 1) +
        getLum(x - 1, y + 1) +
        2 * getLum(x, y + 1) +
        getLum(x + 1, y + 1);

      totalEdge += Math.sqrt(gx * gx + gy * gy);
    }
  }

  // Normalize to 0-1
  const maxPossibleEdge = (width - 2) * (height - 2) * 255 * 4;
  return Math.min(1, totalEdge / maxPossibleEdge);
}

/**
 * Compute center of mass based on luminance
 */
function computeCenterOfMass(pixels: Uint8ClampedArray): {
  x: number;
  y: number;
} {
  const width = SAMPLE_SIZE;
  const height = SAMPLE_SIZE;
  let totalLum = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
      totalLum += lum;
      weightedX += x * lum;
      weightedY += y * lum;
    }
  }

  if (totalLum === 0) {
    return { x: 0.5, y: 0.5 };
  }

  return {
    x: weightedX / totalLum / width,
    y: weightedY / totalLum / height,
  };
}

/**
 * Compute sharpness using Laplacian variance
 */
function computeSharpness(pixels: Uint8ClampedArray): number {
  const width = SAMPLE_SIZE;
  const height = SAMPLE_SIZE;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  const getLum = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
  };

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // Laplacian
      const lap =
        4 * getLum(x, y) -
        getLum(x - 1, y) -
        getLum(x + 1, y) -
        getLum(x, y - 1) -
        getLum(x, y + 1);

      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  // Variance of Laplacian
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;

  // Normalize (empirically, sharp images have variance > 500)
  return Math.min(1, Math.sqrt(variance) / 50);
}

/**
 * Compute 16-bin luminance histogram
 */
function computeLuminanceHistogram(pixels: Uint8ClampedArray): Float32Array {
  const histogram = new Float32Array(16);
  const total = pixels.length / 4;

  for (let i = 0; i < pixels.length; i += 4) {
    const lum = luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
    const bin = Math.min(15, Math.floor(lum / 16));
    histogram[bin]++;
  }

  // Normalize
  for (let i = 0; i < 16; i++) {
    histogram[i] /= total;
  }

  return histogram;
}

/**
 * Compute average luminance
 */
function computeAverageLuminance(pixels: Uint8ClampedArray): number {
  let total = 0;
  const count = pixels.length / 4;

  for (let i = 0; i < pixels.length; i += 4) {
    total += luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
  }

  return total / count / 255;
}

/**
 * Compute dominant hue and saturation
 */
function computeDominantHue(pixels: Uint8ClampedArray): {
  hue: number;
  saturation: number;
} {
  let totalSat = 0;
  let hueX = 0;
  let hueY = 0;
  let count = 0;

  for (let i = 0; i < pixels.length; i += 16) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    if (d > 0.1) {
      // Only consider saturated pixels
      let h = 0;
      if (max === r) {
        h = ((g - b) / d + 6) % 6;
      } else if (max === g) {
        h = (b - r) / d + 2;
      } else {
        h = (r - g) / d + 4;
      }
      h /= 6;

      const s = max === 0 ? 0 : d / max;

      // Weight by saturation
      hueX += Math.cos(h * 2 * Math.PI) * s;
      hueY += Math.sin(h * 2 * Math.PI) * s;
      totalSat += s;
      count++;
    }
  }

  if (count === 0) {
    return { hue: 0, saturation: 0 };
  }

  const avgHue = Math.atan2(hueY / count, hueX / count) / (2 * Math.PI);

  return {
    hue: avgHue < 0 ? avgHue + 1 : avgHue,
    saturation: totalSat / count,
  };
}
