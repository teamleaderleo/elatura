// SPDX-License-Identifier: MPL-2.0

export const INVALID_PATH_TEMPLATE = "/:invalid-url";
export const PATH_OVERFLOW_SEGMENT = ":path-overflow";

const MAX_PATH_SEGMENTS = 64;
const MAX_CLASSIFIED_SEGMENT_LENGTH = 256;

type LengthBucket = "s" | "m" | "l" | "xl";

function lengthBucket(length: number): LengthBucket {
  if (length <= 4) return "s";
  if (length <= 8) return "m";
  if (length <= 16) return "l";
  return "xl";
}

function classifySegment(segment: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
    return ":uuid";
  }

  const bucket = lengthBucket(segment.length);
  if (/^\d+$/.test(segment)) return `:number-${bucket}`;
  if (/^[0-9a-f]{16,}$/i.test(segment)) return `:hex-${bucket}`;
  if (/^[A-Za-z]+(?:-[A-Za-z]+)+$/.test(segment)) return `:compound-${bucket}`;
  if (/^[A-Za-z]+$/.test(segment)) return `:word-${bucket}`;
  if (/^[A-Za-z0-9_-]+$/.test(segment)) return `:token-${bucket}`;
  if (/^[^/]+\.[A-Za-z0-9]{1,10}$/.test(segment)) return `:file-${bucket}`;
  if (/(?:%[0-9A-Fa-f]{2})+/.test(segment)) return `:encoded-${bucket}`;
  return `:segment-${bucket}`;
}

export function redactPath(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname;
    if (pathname === "/") return pathname;

    const tokens: string[] = [];
    let cursor = 1;
    while (cursor <= pathname.length && tokens.length < MAX_PATH_SEGMENTS) {
      const nextSlash = pathname.indexOf("/", cursor);
      const end = nextSlash === -1 ? pathname.length : nextSlash;
      const segmentLength = end - cursor;

      if (segmentLength === 0) tokens.push(":empty");
      else if (segmentLength > MAX_CLASSIFIED_SEGMENT_LENGTH) tokens.push(":segment-xl");
      else tokens.push(classifySegment(pathname.slice(cursor, end)));

      if (nextSlash === -1) {
        cursor = pathname.length + 1;
        break;
      }
      cursor = nextSlash + 1;
    }

    if (cursor <= pathname.length) tokens.push(PATH_OVERFLOW_SEGMENT);
    return `/${tokens.join("/")}`;
  } catch {
    return INVALID_PATH_TEMPLATE;
  }
}

const REDACTED_SEGMENT = /^:(?:uuid|invalid-url|elatura-overflow|path-overflow|empty|(?:number|hex|compound|word|token|file|encoded|segment)-(?:s|m|l|xl))$/;

export function isRedactedPathTemplate(pathTemplate: string): boolean {
  if (pathTemplate === "/") return true;
  if (!pathTemplate.startsWith("/") || pathTemplate.includes("?") || pathTemplate.includes("#")) return false;
  return pathTemplate
    .slice(1)
    .split("/")
    .every((segment) => REDACTED_SEGMENT.test(segment));
}
