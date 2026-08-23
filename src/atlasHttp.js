import { setTimeout as delay } from "node:timers/promises";
import { redactUrl } from "./core/utils.js";

export class SourceHttpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SourceHttpError";
    this.status = details.status ?? null;
    this.url = details.url ?? null;
    this.retryable = details.retryable ?? false;
  }
}

export function createHttpClient(config) {
  return {
    getJson: (url, options = {}) => request(url, { ...options, parse: "json" }, config),
    getText: (url, options = {}) => request(url, { ...options, parse: "text" }, config)
  };
}

async function request(url, options, config) {
  const requestUrl = String(url);
  const safeUrl = redactUrl(requestUrl);
  const timeoutMs = options.timeoutMs || config.timeoutMs;
  const retries = Number.isFinite(options.retries) ? options.retries : 1;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(requestUrl, {
        method: "GET",
        headers: {
          Accept: options.accept || (options.parse === "json" ? "application/json" : "text/plain, application/xml, application/atom+xml, application/rss+xml, */*"),
          "User-Agent": options.userAgent || config.userAgent,
          ...(options.headers || {})
        },
        signal: controller.signal
      });

      if (response.status === 304) {
        return {
          url: safeUrl,
          status: 304,
          contentType: response.headers.get("content-type") || null,
          etag: response.headers.get("etag") || options.headers?.["If-None-Match"] || null,
          lastModified: response.headers.get("last-modified") || options.headers?.["If-Modified-Since"] || null,
          rawPayload: "",
          payloadTruncated: false,
          notModified: true,
          data: null
        };
      }

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new SourceHttpError(`HTTP ${response.status} from ${safeUrl}`, {
          status: response.status,
          url: safeUrl,
          retryable
        });
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > config.maxResponseBytes) {
        throw new SourceHttpError(`Response from ${safeUrl} exceeds ${config.maxResponseBytes} bytes`, {
          status: response.status,
          url: safeUrl,
          retryable: false
        });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > config.maxResponseBytes) {
        throw new SourceHttpError(`Response from ${safeUrl} exceeds ${config.maxResponseBytes} bytes`, {
          status: response.status,
          url: safeUrl,
          retryable: false
        });
      }

      const text = buffer.toString("utf8");
      let data = text;
      if (options.parse === "json") {
        try {
          data = JSON.parse(text.replace(/^\uFEFF/, ""));
        } catch (error) {
          throw new SourceHttpError(`Invalid JSON from ${safeUrl}: ${error.message}`, {
            status: response.status,
            url: safeUrl,
            retryable: false
          });
        }
      }

      const rawPayload = text.slice(0, config.rawPayloadBytes);
      return {
        url: safeUrl,
        status: response.status,
        contentType: response.headers.get("content-type") || null,
        etag: response.headers.get("etag") || null,
        lastModified: response.headers.get("last-modified") || null,
        rawPayload,
        payloadTruncated: text.length > rawPayload.length,
        data
      };
    } catch (error) {
      lastError = normalizeError(error, safeUrl);
      if (attempt >= retries || !lastError.retryable) {
        throw lastError;
      }

      await delay(Math.min(2000, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function normalizeError(error, url) {
  if (error instanceof SourceHttpError) {
    return error;
  }

  if (error?.name === "AbortError") {
    return new SourceHttpError(`Request timed out: ${url}`, { url, retryable: true });
  }

  const errorCode = error?.cause?.code || error?.code || null;
  const message = errorCode ? `Request failed (${errorCode}): ${url}` : error?.message || `Request failed: ${url}`;
  return new SourceHttpError(message, {
    url,
    retryable: true
  });
}
