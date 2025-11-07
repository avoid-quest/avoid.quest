import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { Window } from "happy-dom";
import DOMPurify from "dompurify";
import { MAX_CAPTION_LENGTH } from "./types";

/**
 * Escape HTML entities in text to make it safe for Telegram HTML parsing
 */
export function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert Instagram @ mentions to clickable Instagram profile links
 * Only converts mentions that are NOT already inside HTML tags
 * Uses happy-dom to properly parse HTML and avoid nested tags
 */
export function linkMentions(html: string): string {
  if (!html || html.trim().length === 0) {
    return html;
  }

  // Use happy-dom to parse HTML properly
  const window = new Window();
  const document = window.document;
  
  // Create a temporary container
  const container = document.createElement("div");
  container.innerHTML = html;

  // Walk through text nodes and convert @ mentions
  function processNode(node: Node): void {
    if (node.nodeType === 3) {
      // Text node - process for @ mentions
      const text = node.textContent || "";
      const mentionRegex = /@([a-zA-Z0-9._]+)/g;
      const matches = Array.from(text.matchAll(mentionRegex));

      if (matches.length > 0) {
        // Build new content with links
        let newContent = "";
        let lastIndex = 0;

        for (const match of matches) {
          if (match.index === undefined) continue;
          
          // Add text before the mention
          newContent += text.substring(lastIndex, match.index);
          
          // Create link element
          const link = document.createElement("a");
          const username = match[1];
          link.href = `https://instagram.com/${username}`;
          link.textContent = `@${username}`;
          
          // Add link as text representation (we'll convert to HTML later)
          newContent += link.outerHTML;
          
          lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        newContent += text.substring(lastIndex);

        // Replace text node with parsed HTML
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = newContent;
        
        // Replace the text node with the new nodes
        const parent = node.parentNode;
        if (parent) {
          while (tempDiv.firstChild) {
            parent.insertBefore(tempDiv.firstChild, node);
          }
          parent.removeChild(node);
        }
      }
    } else if (node.nodeType === 1) {
      // Element node - recursively process children
      // Skip if it's already an <a> tag
      if ((node as Element).tagName !== "A") {
        const children = Array.from(node.childNodes);
        for (const child of children) {
          processNode(child);
        }
      }
    }
  }

  // Process all nodes in the container
  const children = Array.from(container.childNodes);
  for (const child of children) {
    processNode(child);
  }

  return container.innerHTML;
}

/**
 * Sanitize HTML to prevent parsing errors in Telegram
 * Uses DOMPurify to ensure valid, safe HTML
 */
export function sanitizeHtmlForTelegram(html: string): string {
  if (!html || html.trim().length === 0) {
    return html;
  }

  // Create a window for DOMPurify (needed for server-side usage)
  const window = new Window();
  const purify = DOMPurify(window as unknown as Window & typeof globalThis);

  // Configure DOMPurify for Telegram HTML mode
  // Telegram supports: <b>, <i>, <u>, <s>, <a>, <code>, <pre>
  // We only use <a> tags for links
  const clean = purify.sanitize(html, {
    ALLOWED_TAGS: ["a"],
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false,
  });

  return clean.trim();
}

/**
 * Truncate HTML content by counting actual text content, not HTML markup
 * Uses happy-dom to properly extract text content
 */
function truncateHtmlContent(html: string, maxLength: number): string {
  if (!html || html.trim().length === 0) {
    return html;
  }

  // Use happy-dom to extract plain text
  const window = new Window();
  const document = window.document;
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  const textContent = tempDiv.textContent || "";

  // Account for HTML markup overhead
  // Each @ mention becomes ~50 chars of HTML, plus Instagram link at end
  const mentionCount = (textContent.match(/@/g) || []).length;
  const estimatedHtmlOverhead = mentionCount * 50 + 50; // Extra buffer
  const safeMaxLength = Math.max(0, maxLength - estimatedHtmlOverhead);

  if (safeMaxLength <= 0) {
    return "";
  }

  // Truncate plain text
  const truncatedText = textContent.substring(0, safeMaxLength) + "...";

  // Escape HTML entities FIRST
  const escapedText = escapeHtmlEntities(truncatedText);

  // Convert @ mentions to HTML links AFTER escaping
  const htmlWithLinks = linkMentions(escapedText);

  // Sanitize the final HTML
  return sanitizeHtmlForTelegram(htmlWithLinks);
}

/**
 * Create caption with proper formatting and truncation
 */
export function createCaption(post: Doc<"posts">): string {
  let caption = "";

  if (post.caption) {
    // Preserve original formatting but clean up excessive whitespace
    caption = post.caption
      .replace(/\s{3,}/g, " ") // Replace 3+ spaces with single space
      .replace(/\n\s*\n\s*\n/g, "\n\n") // Replace 3+ newlines with double newline
      .trim();

    // Escape HTML entities FIRST to make it safe for Telegram
    caption = escapeHtmlEntities(caption);

    // Convert Instagram @ mentions to clickable links AFTER escaping
    caption = linkMentions(caption);
  }

  // Add Instagram link as footer
  const instagramLink = post.url
    ? `\n\n<a href="${post.url}">View on Instagram</a>`
    : "";

  let combined = caption + instagramLink;

  // Telegram caption limit is 1024 characters
  if (combined.length > MAX_CAPTION_LENGTH) {
    // Extract Instagram link for preservation
    const instagramLinkMatch = combined.match(
      /\n\n<a href="([^"]+)">View on Instagram<\/a>/
    );
    const instagramLinkHtml = instagramLinkMatch ? instagramLinkMatch[0] : "";

    // Get caption without Instagram link
    const captionWithoutLink = instagramLinkHtml
      ? combined.replace(instagramLinkHtml, "").trim()
      : combined;

    // Calculate available space for content (reserve space for Instagram link)
    const linkLength = instagramLinkHtml.length;
    const availableLength = MAX_CAPTION_LENGTH - linkLength;

    // Truncate HTML content by counting actual text content, not HTML markup
    const truncatedHtml = truncateHtmlContent(
      captionWithoutLink,
      availableLength
    );

    // Add back Instagram link
    combined = truncatedHtml + instagramLinkHtml;
  }

  return combined;
}

