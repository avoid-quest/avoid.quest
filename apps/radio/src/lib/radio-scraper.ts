import type { RadioMetadata, ScrapedOption } from "@avoid.quest/radio-shared";

const CORS_PROXY = "https://api.allorigins.win/raw?url=";
const FETCH_TIMEOUT = 10_000; // 10 seconds
const LARGE_FAVICON_SIZE = 64;
const SMALL_IMAGE_SIZE = 50;
const FIRST_PARAGRAPH_MIN_LENGTH = 20;
const FIRST_PARAGRAPH_MAX_LENGTH = 500;

// Common radio platform patterns
const STREAM_PATTERN = /\/stream/i;
const LIVE_PATTERN = /\/live/i;
const RADIO_PATTERN = /\/radio/i;
const AUDIO_PATTERN = /\/audio/i;
const ICECAST_PATTERN = /icecast/i;
const SHOUTCAST_PATTERN = /shoutcast/i;
const AZURACAST_PATTERN = /azuracast/i;
const RADIO_CO_PATTERN = /radio\.co/i;
const RADIOKING_PATTERN = /radioking/i;

export async function scrapeRadioMetadata(
  websiteUrl: string
): Promise<RadioMetadata> {
  try {
    const response = await fetchWithTimeout(
      `${CORS_PROXY}${encodeURIComponent(websiteUrl)}`,
      {
        timeout: FETCH_TIMEOUT,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const metadata: RadioMetadata = {
      websiteUrl,
      foundFields: [],
      missingFields: [],
    };

    // Extract name options
    const nameOptions = extractNameOptions(doc);
    if (nameOptions.length > 0) {
      metadata.name = nameOptions;
      metadata.foundFields.push("name");
    } else {
      metadata.missingFields.push("name");
    }

    // Extract stream URL options
    const streamOptions = extractStreamOptions(doc, websiteUrl);
    if (streamOptions.length > 0) {
      metadata.streamUrl = streamOptions;
      metadata.foundFields.push("streamUrl");
    } else {
      metadata.missingFields.push("streamUrl");
    }

    // Extract logo options
    const logoOptions = extractLogoOptions(doc, websiteUrl);
    if (logoOptions.length > 0) {
      metadata.logoUrl = logoOptions;
      metadata.foundFields.push("logoUrl");
    } else {
      metadata.missingFields.push("logoUrl");
    }

    // Extract description options
    const descriptionOptions = extractDescriptionOptions(doc);
    if (descriptionOptions.length > 0) {
      metadata.description = descriptionOptions;
      metadata.foundFields.push("description");
    } else {
      metadata.missingFields.push("description");
    }

    return metadata;
  } catch (error) {
    console.error("Error scraping radio metadata:", error);
    throw new Error(
      `Failed to fetch website data: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function fetchWithTimeout(
  url: string,
  options: { timeout: number }
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    fetch(url, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timeoutId);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function extractNameOptions(doc: Document): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Open Graph title
  const ogTitle = doc
    .querySelector('meta[property="og:title"]')
    ?.getAttribute("content");
  if (ogTitle) {
    options.push({
      value: ogTitle,
      label: `Open Graph: ${ogTitle}`,
      confidence: 0.9,
    });
  }

  // Page title
  const title = doc.querySelector("title")?.textContent?.trim();
  if (title && title !== ogTitle) {
    options.push({
      value: title,
      label: `Page Title: ${title}`,
      confidence: 0.8,
    });
  }

  // H1 content
  const h1 = doc.querySelector("h1")?.textContent?.trim();
  if (h1 && h1 !== ogTitle && h1 !== title) {
    options.push({
      value: h1,
      label: `Heading: ${h1}`,
      confidence: 0.7,
    });
  }

  // JSON-LD name
  const jsonLdScripts = doc.querySelectorAll(
    'script[type="application/ld+json"]'
  );
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || "{}");
      if (data.name && typeof data.name === "string") {
        options.push({
          value: data.name,
          label: `JSON-LD: ${data.name}`,
          confidence: 0.8,
        });
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  // Remove duplicates and sort by confidence
  return options
    .filter(
      (option, index, self) =>
        index === self.findIndex((o) => o.value === option.value)
    )
    .sort((a, b) => b.confidence - a.confidence);
}

function extractAudioElements(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Extract different types of audio elements
  options.push(...extractDirectAudioElements(doc, baseUrl));
  options.push(...extractAudioSourceElements(doc, baseUrl));
  options.push(...extractCommentedAudioElements(doc, baseUrl));

  return options;
}

function extractDirectAudioElements(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const audioElements = doc.querySelectorAll("audio[src]");

  for (const audio of audioElements) {
    const src = audio.getAttribute("src");
    if (src && isValidAudioUrl(src)) {
      const label =
        audio.getAttribute("title") ||
        audio.getAttribute("aria-label") ||
        "Audio Stream";
      options.push({
        value: resolveUrl(src, baseUrl),
        label: `Audio Element: ${label}`,
        confidence: 0.95,
      });
    }
  }

  return options;
}

function extractAudioSourceElements(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Look for <source> elements inside <audio> tags
  const sourceElements = doc.querySelectorAll("audio source[src]");
  for (const source of sourceElements) {
    const src = source.getAttribute("src");
    if (src && isValidAudioUrl(src)) {
      const type = source.getAttribute("type") || "audio";
      const audioParent = source.closest("audio");
      const label =
        audioParent?.getAttribute("title") ||
        audioParent?.getAttribute("aria-label") ||
        `${type} stream`;

      options.push({
        value: resolveUrl(src, baseUrl),
        label: `Audio Source: ${label}`,
        confidence: 0.9,
      });
    }
  }

  // Look for <source> elements with audio types
  const allSources = doc.querySelectorAll("source[src]");
  for (const source of allSources) {
    const src = source.getAttribute("src");
    const type = source.getAttribute("type");
    if (src && type && type.startsWith("audio/") && isValidAudioUrl(src)) {
      options.push({
        value: resolveUrl(src, baseUrl),
        label: `Audio Source: ${type}`,
        confidence: 0.85,
      });
    }
  }

  return options;
}

function extractCommentedAudioElements(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Look for commented audio elements in HTML content
  const htmlContent = doc.documentElement.outerHTML;

  // Multiple patterns to catch different comment formats
  const commentedAudioPatterns = [
    /<!--\s*<audio[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi,
    /<!--\s*<audio[^>]*src\s*=\s*["']([^"']+)["'][^>]*-->/gi,
    /<!--\s*<audio[^>]*src\s*=\s*["']([^"']+)["'][^>]*\s*-->/gi,
  ];

  for (const pattern of commentedAudioPatterns) {
    const matches = htmlContent.matchAll(pattern);
    for (const match of matches) {
      const src = match[1];
      if (src && isValidAudioUrl(src)) {
        options.push({
          value: resolveUrl(src, baseUrl),
          label: "Commented Audio Element",
          confidence: 0.8,
        });
      }
    }
  }

  return options;
}

function extractAudioLinks(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Look for links with audio URLs
  options.push(...extractAudioLinksFromAnchors(doc, baseUrl));

  // Look for buttons with audio URLs in onclick handlers
  options.push(...extractAudioLinksFromButtons(doc, baseUrl));

  return options;
}

function extractAudioLinksFromAnchors(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const audioLinks = doc.querySelectorAll("a[href]");

  for (const link of audioLinks) {
    const href = link.getAttribute("href");
    if (href && isValidAudioUrl(href)) {
      const label = createAudioLinkLabel(link);
      options.push({
        value: resolveUrl(href, baseUrl),
        label,
        confidence: 0.8,
      });
    }
  }

  return options;
}

function createAudioLinkLabel(link: Element): string {
  const text = link.textContent?.trim() || "";
  const title = link.getAttribute("title") || "";
  const ariaLabel = link.getAttribute("aria-label") || "";
  const download = link.getAttribute("download");

  if (text) {
    return `Audio Link: ${text}`;
  }
  if (title) {
    return `Audio Link: ${title}`;
  }
  if (ariaLabel) {
    return `Audio Link: ${ariaLabel}`;
  }
  if (download) {
    return `Audio Download: ${download}`;
  }
  return "Audio Link";
}

function extractAudioLinksFromButtons(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const audioButtons = doc.querySelectorAll("button[onclick], input[onclick]");

  for (const button of audioButtons) {
    const onclick = button.getAttribute("onclick");
    if (onclick) {
      // Extract URLs from onclick handlers
      const urlMatch = onclick.match(AUDIO_URL_PATTERN);
      if (urlMatch) {
        const url = urlMatch[0];
        const text =
          button.textContent?.trim() ||
          button.getAttribute("value") ||
          "Audio Button";
        options.push({
          value: resolveUrl(url, baseUrl),
          label: `Audio Button: ${text}`,
          confidence: 0.7,
        });
      }
    }
  }

  return options;
}

function extractRadioPlatformLinks(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const audioLinks = doc.querySelectorAll("a[href]");

  const radioPatterns = [
    STREAM_PATTERN,
    LIVE_PATTERN,
    RADIO_PATTERN,
    AUDIO_PATTERN,
    ICECAST_PATTERN,
    SHOUTCAST_PATTERN,
    AZURACAST_PATTERN,
    RADIO_CO_PATTERN,
    RADIOKING_PATTERN,
  ];

  for (const link of audioLinks) {
    const href = link.getAttribute("href");
    if (href) {
      const fullUrl = resolveUrl(href, baseUrl);
      const hasRadioPattern = radioPatterns.some((pattern) =>
        pattern.test(fullUrl)
      );

      // Only include if it's a valid audio URL and not a navigation link
      if (
        hasRadioPattern &&
        isValidAudioUrl(fullUrl) &&
        !options.some((opt) => opt.value === fullUrl)
      ) {
        const text = link.textContent?.trim() || "";
        const label = text
          ? `Radio Platform: ${text}`
          : `Radio Platform: ${href}`;

        options.push({
          value: fullUrl,
          label,
          confidence: 0.6,
        });
      }
    }
  }

  return options;
}

function extractJsonLdAudio(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const jsonLdScripts = doc.querySelectorAll(
    'script[type="application/ld+json"]'
  );

  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || "{}");
      if (data["@type"] === "AudioObject" && data.contentUrl) {
        options.push({
          value: resolveUrl(data.contentUrl, baseUrl),
          label: `JSON-LD Audio: ${data.contentUrl}`,
          confidence: 0.8,
        });
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  return options;
}

function extractStreamOptions(doc: Document, baseUrl: string): ScrapedOption[] {
  const options = [
    ...extractAudioElements(doc, baseUrl),
    ...extractAudioLinks(doc, baseUrl),
    ...extractRadioPlatformLinks(doc, baseUrl),
    ...extractJsonLdAudio(doc, baseUrl),
    ...extractDataAttributes(doc, baseUrl),
    ...extractJavaScriptAudio(doc, baseUrl),
  ];

  return options
    .filter(
      (option, index, self) =>
        index === self.findIndex((o) => o.value === option.value)
    )
    .sort((a, b) => b.confidence - a.confidence);
}

function extractDataAttributes(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Look for elements with data-audio, data-src, data-stream attributes
  const dataSelectors = [
    "[data-audio]",
    "[data-src]",
    "[data-stream]",
    "[data-url]",
    "[data-audio-src]",
    "[data-stream-url]",
  ];

  for (const selector of dataSelectors) {
    const elements = doc.querySelectorAll(selector);
    for (const element of elements) {
      const dataAudio = element.getAttribute("data-audio");
      const dataSrc = element.getAttribute("data-src");
      const dataStream = element.getAttribute("data-stream");
      const dataUrl = element.getAttribute("data-url");
      const dataAudioSrc = element.getAttribute("data-audio-src");
      const dataStreamUrl = element.getAttribute("data-stream-url");

      const urls = [
        dataAudio,
        dataSrc,
        dataStream,
        dataUrl,
        dataAudioSrc,
        dataStreamUrl,
      ].filter(Boolean);

      for (const url of urls) {
        if (url && isValidAudioUrl(url)) {
          const tagName = element.tagName.toLowerCase();
          const className = element.getAttribute("class") || "";
          const id = element.getAttribute("id") || "";
          const label = className || id || `${tagName} element`;

          options.push({
            value: resolveUrl(url, baseUrl),
            label: `Data Attribute: ${label}`,
            confidence: 0.75,
          });
        }
      }
    }
  }

  return options;
}

function extractJavaScriptAudio(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Look for script tags with audio URLs
  const scripts = doc.querySelectorAll("script");
  for (const script of scripts) {
    const content = script.textContent || "";

    // Look for common audio URL patterns in JavaScript
    const audioUrlPatterns = [
      /https?:\/\/[^\s'"]+\.(mp3|ogg|aac|m4a|wav|flac|m3u8|pls|m3u)/gi,
      /['"`]([^'"`]*\.(mp3|ogg|aac|m4a|wav|flac|m3u8|pls|m3u))['"`]/gi,
      /streamUrl\s*[:=]\s*['"`]([^'"`]+)['"`]/gi,
      /audioUrl\s*[:=]\s*['"`]([^'"`]+)['"`]/gi,
      /src\s*[:=]\s*['"`]([^'"`]*\.(mp3|ogg|aac|m4a|wav|flac|m3u8|pls|m3u))['"`]/gi,
    ];

    for (const pattern of audioUrlPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const url = match[1] || match[0];
        if (url && isValidAudioUrl(url)) {
          options.push({
            value: resolveUrl(url, baseUrl),
            label: "JavaScript Audio URL",
            confidence: 0.6,
          });
        }
      }
    }
  }

  return options;
}

function extractLogoOptions(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Extract different types of logos with different priorities
  options.push(...extractExplicitLogos(doc, baseUrl));
  options.push(...extractHeaderLogos(doc, baseUrl));
  options.push(...extractMetaLogos(doc, baseUrl));
  options.push(...extractLargeFavicons(doc, baseUrl));
  options.push(...extractModernImageFormats(doc, baseUrl));

  return options
    .filter(
      (option, index, self) =>
        index === self.findIndex((o) => o.value === option.value)
    )
    .sort((a, b) => b.confidence - a.confidence);
}

function extractExplicitLogos(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Look for images with logo-related attributes
  options.push(...extractLogosByAttributes(doc, baseUrl));

  // Look for images with logo-related filenames
  options.push(...extractLogosByFilename(doc, baseUrl));

  return options;
}

function extractLogosByAttributes(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  options.push(...extractImageLogos(doc, baseUrl));
  options.push(...extractSvgLogos(doc, baseUrl));
  options.push(...extractContainerLogos(doc, baseUrl));

  return options;
}

function extractImageLogos(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const imageSelectors = [
    'img[class*="logo"]',
    'img[id*="logo"]',
    'img[alt*="logo" i]',
    'img[alt*="brand" i]',
    'img[title*="logo" i]',
    'img[title*="brand" i]',
  ];

  for (const selector of imageSelectors) {
    const elements = doc.querySelectorAll(selector);
    for (const element of elements) {
      const src = element.getAttribute("src");
      if (src && !isFavicon(src)) {
        const alt = element.getAttribute("alt") || "";
        const className = element.getAttribute("class") || "";
        const label = alt || className || `Logo: ${selector}`;

        options.push({
          value: resolveUrl(src, baseUrl),
          label: `Logo: ${label}`,
          confidence: 0.95,
          preview: resolveUrl(src, baseUrl),
        });
      }
    }
  }

  return options;
}

function extractSvgLogos(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const svgSelectors = [
    'svg[class*="logo"]',
    'svg[id*="logo"]',
    'svg[aria-label*="logo" i]',
    'svg[aria-label*="brand" i]',
  ];

  for (const selector of svgSelectors) {
    const elements = doc.querySelectorAll(selector);
    for (const element of elements) {
      const src = element.getAttribute("src");
      if (src && !isFavicon(src)) {
        const alt = element.getAttribute("aria-label") || "";
        const className = element.getAttribute("class") || "";
        const label = alt || className || `Logo: ${selector}`;

        options.push({
          value: resolveUrl(src, baseUrl),
          label: `Logo: ${label}`,
          confidence: 0.95,
          preview: resolveUrl(src, baseUrl),
        });
      }
    }
  }

  return options;
}

function extractContainerLogos(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const containerSelectors = [
    ".logo img",
    "#logo img",
    ".brand img",
    "#brand img",
    ".site-logo img",
    ".header-logo img",
    ".main-logo img",
    ".logo svg",
    "#logo svg",
    ".brand svg",
    "#brand svg",
    ".site-logo svg",
    ".header-logo svg",
    ".main-logo svg",
  ];

  for (const selector of containerSelectors) {
    const elements = doc.querySelectorAll(selector);
    for (const element of elements) {
      const src = element.getAttribute("src");
      if (src && !isFavicon(src)) {
        const alt =
          element.getAttribute("alt") ||
          element.getAttribute("aria-label") ||
          "";
        const className = element.getAttribute("class") || "";
        const label = alt || className || `Logo: ${selector}`;

        options.push({
          value: resolveUrl(src, baseUrl),
          label: `Logo: ${label}`,
          confidence: 0.95,
          preview: resolveUrl(src, baseUrl),
        });
      }
    }
  }

  return options;
}

function extractLogosByFilename(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  // Look for both img and svg elements
  const allImages = doc.querySelectorAll("img[src], svg[src]");

  for (const img of allImages) {
    const src = img.getAttribute("src");
    if (src && isLogoFilename(src) && !isFavicon(src)) {
      const alt =
        img.getAttribute("alt") || img.getAttribute("aria-label") || "";
      const filename = src.split("/").pop() || "";

      options.push({
        value: resolveUrl(src, baseUrl),
        label: `Logo: ${alt || filename}`,
        confidence: 0.9,
        preview: resolveUrl(src, baseUrl),
      });
    }
  }

  return options;
}

function extractHeaderLogos(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const headerSelectors = [
    "header img",
    ".header img",
    ".navbar img",
    ".nav img",
    ".navigation img",
    ".site-header img",
    ".main-header img",
    // Also look for SVGs in headers
    "header svg",
    ".header svg",
    ".navbar svg",
    ".nav svg",
    ".navigation svg",
    ".site-header svg",
    ".main-header svg",
  ];

  for (const selector of headerSelectors) {
    const headerElements = doc.querySelectorAll(selector);
    for (const headerElement of headerElements) {
      const src = headerElement.getAttribute("src");
      if (src && !isFavicon(src) && !isSmallImage(headerElement)) {
        const alt =
          headerElement.getAttribute("alt") ||
          headerElement.getAttribute("aria-label") ||
          "";
        const elementType = headerElement.tagName.toLowerCase();
        options.push({
          value: resolveUrl(src, baseUrl),
          label: `Header ${elementType.toUpperCase()}: ${alt || "Logo"}`,
          confidence: 0.8,
          preview: resolveUrl(src, baseUrl),
        });
      }
    }
  }

  return options;
}

function extractMetaLogos(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Open Graph image
  const ogImage = doc
    .querySelector('meta[property="og:image"]')
    ?.getAttribute("content");
  if (ogImage && !isFavicon(ogImage)) {
    options.push({
      value: resolveUrl(ogImage, baseUrl),
      label: "Open Graph Image",
      confidence: 0.7,
      preview: resolveUrl(ogImage, baseUrl),
    });
  }

  // Apple touch icon
  const appleTouchIcon = doc
    .querySelector('link[rel="apple-touch-icon"]')
    ?.getAttribute("href");
  if (appleTouchIcon && !isFavicon(appleTouchIcon)) {
    options.push({
      value: resolveUrl(appleTouchIcon, baseUrl),
      label: "Apple Touch Icon",
      confidence: 0.6,
      preview: resolveUrl(appleTouchIcon, baseUrl),
    });
  }

  return options;
}

function extractLargeFavicons(doc: Document, baseUrl: string): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const favicons = doc.querySelectorAll('link[rel*="icon"]');

  for (const favicon of favicons) {
    const href = favicon.getAttribute("href");
    const sizes = favicon.getAttribute("sizes");
    if (href && !isFavicon(href) && isLargeFavicon(sizes)) {
      options.push({
        value: resolveUrl(href, baseUrl),
        label: `Large Favicon (${sizes})`,
        confidence: 0.5,
        preview: resolveUrl(href, baseUrl),
      });
    }
  }

  return options;
}

function extractModernImageFormats(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  options.push(...extractModernLinkImages(doc, baseUrl));
  options.push(...extractModernMetaImages(doc, baseUrl));

  return options;
}

function extractModernLinkImages(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const modernImageSelectors = [
    'link[rel="icon"][type*="svg"]',
    'link[rel="icon"][type*="webp"]',
    'link[rel="icon"][type*="avif"]',
    'link[rel="icon"][type*="heic"]',
    'link[rel="apple-touch-icon"][type*="webp"]',
    'link[rel="apple-touch-icon"][type*="avif"]',
    'link[rel="apple-touch-icon"][type*="heic"]',
  ];

  for (const selector of modernImageSelectors) {
    const elements = doc.querySelectorAll(selector);
    for (const element of elements) {
      const href = element.getAttribute("href");
      const type = element.getAttribute("type") || "";
      const sizes = element.getAttribute("sizes") || "";

      if (href && !isFavicon(href)) {
        const format = getImageFormat(type);

        options.push({
          value: resolveUrl(href, baseUrl),
          label: `${format} Icon${sizes ? ` (${sizes})` : ""}`,
          confidence: 0.7,
          preview: resolveUrl(href, baseUrl),
        });
      }
    }
  }

  return options;
}

function extractModernMetaImages(
  doc: Document,
  baseUrl: string
): ScrapedOption[] {
  const options: ScrapedOption[] = [];
  const metaImageSelectors = [
    'meta[property="og:image"][content*=".svg"]',
    'meta[property="og:image"][content*=".webp"]',
    'meta[property="og:image"][content*=".avif"]',
    'meta[property="og:image"][content*=".heic"]',
  ];

  for (const selector of metaImageSelectors) {
    const elements = doc.querySelectorAll(selector);
    for (const element of elements) {
      const content = element.getAttribute("content");
      if (content && !isFavicon(content)) {
        const format = getImageFormatFromContent(content);

        options.push({
          value: resolveUrl(content, baseUrl),
          label: `Open Graph ${format} Image`,
          confidence: 0.6,
          preview: resolveUrl(content, baseUrl),
        });
      }
    }
  }

  return options;
}

function getImageFormat(type: string): string {
  if (type.includes("svg")) {
    return "SVG";
  }
  if (type.includes("webp")) {
    return "WebP";
  }
  if (type.includes("avif")) {
    return "AVIF";
  }
  if (type.includes("heic")) {
    return "HEIC";
  }
  return "Modern";
}

function getImageFormatFromContent(content: string): string {
  if (content.includes(".svg")) {
    return "SVG";
  }
  if (content.includes(".webp")) {
    return "WebP";
  }
  if (content.includes(".avif")) {
    return "AVIF";
  }
  if (content.includes(".heic")) {
    return "HEIC";
  }
  return "Modern";
}

// Helper functions for logo detection
const FAVICON_PATTERNS = [
  /favicon/i,
  /icon/i,
  /apple-touch-icon/i,
  /android-chrome/i,
  /manifest/i,
];

const SIZE_PATTERN = /(\d+)x(\d+)/;

const LOGO_FILENAME_PATTERNS = [
  /logo/i,
  /brand/i,
  /header/i,
  /site/i,
  /company/i,
  /corp/i,
  /identity/i,
  /mark/i,
  /symbol/i,
  /emblem/i,
  /badge/i,
  /crest/i,
  /seal/i,
  /stamp/i,
  /signature/i,
  /watermark/i,
];

const AUDIO_URL_PATTERN =
  /https?:\/\/[^\s'"]+\.(mp3|ogg|aac|m4a|wav|flac|m3u8|pls|m3u)/i;

const EXCLUDE_PATTERNS = [
  /\/index\.html?$/i,
  /\/schedule\/?$/i,
  /\/shows\/?$/i,
  /\/events\/?$/i,
  /\/info\/?$/i,
  /\/donate\/?$/i,
  /\/contact\/?$/i,
  /\/about\/?$/i,
  /\/privacy\/?$/i,
  /\/terms\/?$/i,
  /\/help\/?$/i,
  /\/support\/?$/i,
  /cdn-cgi\/l\/email-protection/i,
  /\.html?$/i,
  /\/#/i,
];

function isFavicon(url: string): boolean {
  return FAVICON_PATTERNS.some((pattern) => pattern.test(url));
}

function isSmallImage(img: Element): boolean {
  const width = img.getAttribute("width");
  const height = img.getAttribute("height");
  if (width && height) {
    const w = Number.parseInt(width, 10);
    const h = Number.parseInt(height, 10);
    return w < SMALL_IMAGE_SIZE || h < SMALL_IMAGE_SIZE;
  }
  return false;
}

function isLargeFavicon(sizes: string | null): boolean {
  if (!sizes) {
    return false;
  }
  const sizeMatch = sizes.match(SIZE_PATTERN);
  if (sizeMatch) {
    const size = Math.max(
      Number.parseInt(sizeMatch[1] ?? "0", 10),
      Number.parseInt(sizeMatch[2] ?? "0", 10)
    );
    return size >= LARGE_FAVICON_SIZE; // Only include favicons 64px or larger
  }
  return false;
}

function isLogoFilename(url: string): boolean {
  const filename = url.split("/").pop()?.toLowerCase() || "";
  return LOGO_FILENAME_PATTERNS.some((pattern) => pattern.test(filename));
}

function extractDescriptionOptions(doc: Document): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  // Open Graph description
  const ogDescription = doc
    .querySelector('meta[property="og:description"]')
    ?.getAttribute("content");
  if (ogDescription) {
    options.push({
      value: ogDescription,
      label: "Open Graph Description",
      confidence: 0.9,
    });
  }

  // Meta description
  const metaDescription = doc
    .querySelector('meta[name="description"]')
    ?.getAttribute("content");
  if (metaDescription && metaDescription !== ogDescription) {
    options.push({
      value: metaDescription,
      label: "Meta Description",
      confidence: 0.8,
    });
  }

  // JSON-LD description
  const jsonLdScripts = doc.querySelectorAll(
    'script[type="application/ld+json"]'
  );
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || "{}");
      if (data.description && typeof data.description === "string") {
        options.push({
          value: data.description,
          label: "JSON-LD Description",
          confidence: 0.8,
        });
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  // First paragraph
  const firstParagraph = doc.querySelector("p")?.textContent?.trim();
  if (
    firstParagraph &&
    firstParagraph.length > FIRST_PARAGRAPH_MIN_LENGTH &&
    firstParagraph.length < FIRST_PARAGRAPH_MAX_LENGTH
  ) {
    options.push({
      value: firstParagraph,
      label: "First Paragraph",
      confidence: 0.5,
    });
  }

  return options
    .filter(
      (option, index, self) =>
        index === self.findIndex((o) => o.value === option.value)
    )
    .sort((a, b) => b.confidence - a.confidence);
}

const M3U8_PATTERN = /\.m3u8?$/i;
const PLS_PATTERN = /\.pls$/i;
const STREAM_URL_PATTERN = /stream/i;
const LIVE_URL_PATTERN = /live/i;
const RADIO_STREAM_PATTERN = /:\d{4,5}\/[^/\s]+$/i; // Port number followed by path (e.g., :8009/fango)
const RADIO_HOST_PATTERN = /\.(ovh|radio|stream|cast|ice|shout)/i; // Radio-related domains
const RADIO_PORT_PATTERN = /:\d{4,5}\//i; // Any port number (8000-99999)

function isValidAudioUrl(url: string): boolean {
  // Check if URL should be excluded
  if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(url))) {
    return false;
  }

  const audioExtensions = [".mp3", ".ogg", ".aac", ".m4a", ".wav", ".flac"];
  const audioMimeTypes = ["audio/", "application/ogg"];
  const streamPatterns = [
    M3U8_PATTERN,
    PLS_PATTERN,
    STREAM_URL_PATTERN,
    LIVE_URL_PATTERN,
    RADIO_STREAM_PATTERN,
    RADIO_HOST_PATTERN,
    RADIO_PORT_PATTERN,
  ];

  return (
    audioExtensions.some((ext) => url.toLowerCase().includes(ext)) ||
    audioMimeTypes.some((type) => url.includes(type)) ||
    streamPatterns.some((pattern) => pattern.test(url))
  );
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}
