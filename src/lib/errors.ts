/**
 * Map a failed `/api/v1/md` response onto a user-facing message.
 *
 * Wording follows the VS Code and Zed clients (MAK-191's precedent): a saved
 * key that fails is the user's to fix, anonymous 401s point at sign-up, 429
 * carries the server's tip (which names both upgrade paths) and a sign-up
 * hint when the server sent none, and 400/413 surface the server's own
 * wording rather than inventing a substitute.
 */

import { SIGNUP_URL } from "./service";

export type RenderErrorKind =
  | "auth"
  | "rate-limit"
  | "bad-request"
  | "payload-too-large"
  | "server"
  | "network"
  | "unknown";

export interface MappedError {
  kind: RenderErrorKind;
  message: string;
}

interface ErrorBody {
  error?: unknown;
  details?: unknown;
  hint?: unknown;
  tip?: unknown;
  limit?: unknown;
  actual?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Parse an error body without ever throwing; `{}` for anything unreadable. */
export function parseErrorBody(text: string): ErrorBody {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? (parsed as ErrorBody) : {};
  } catch {
    return {};
  }
}

export interface ErrorMapOptions {
  /** Whether the request carried a user-configured API key. */
  hasKey: boolean;
}

export function mapHttpError(status: number, bodyText: string, options: ErrorMapOptions): MappedError {
  const body = parseErrorBody(bodyText);

  if (status === 401 || status === 403) {
    if (options.hasKey) {
      return {
        kind: "auth",
        message: "Authentication failed. Check the API key in the makesPDF extension options.",
      };
    }
    return {
      kind: "auth",
      message:
        `This server requires an account. Create one at ${SIGNUP_URL} ` +
        "and save your API key in the extension options.",
    };
  }

  if (status === 429) {
    const tip = asString(body.tip);
    if (tip) return { kind: "rate-limit", message: `Rate limited. ${tip}` };
    return {
      kind: "rate-limit",
      message: options.hasKey
        ? "Rate limited. Wait a few minutes and try again."
        : `Rate limited. Wait a few minutes and try again, or sign up at ${SIGNUP_URL} for higher limits.`,
    };
  }

  if (status === 400) {
    const code = asString(body.error);
    if (code === "page-cap-exceeded") {
      const limit = asNumber(body.limit);
      const actual = asNumber(body.actual);
      return {
        kind: "bad-request",
        message:
          `Document is too long for an anonymous render (${actual ?? "many"} pages, ` +
          `cap ${limit ?? "the anonymous cap"}). Sign up for higher limits.`,
      };
    }
    const details = Array.isArray(body.details) ? body.details.filter((d): d is string => typeof d === "string") : [];
    return {
      kind: "bad-request",
      message: `makesPDF rejected the document: ${code ?? details[0] ?? "Bad request"}`,
    };
  }

  if (status === 413) {
    const code = asString(body.error);
    return {
      kind: "payload-too-large",
      message:
        `makesPDF rejected the document: ${code ?? "Payload too large"}. ` +
        "Remove some images or split the file and try again.",
    };
  }

  if (status >= 500) {
    const code = asString(body.error);
    return {
      kind: "server",
      message: `makesPDF returned an error (HTTP ${status})${code ? `: ${code}` : ""}. Try again in a moment.`,
    };
  }

  const code = asString(body.error) ?? bodyText.trim();
  return {
    kind: "unknown",
    message: `makesPDF request failed (HTTP ${status})${code ? `: ${code.slice(0, 200)}` : ""}.`,
  };
}

/** Map a thrown fetch/network error onto the same shape. */
export function mapFetchError(error: unknown): MappedError {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return { kind: "network", message: "makesPDF did not respond in time. Try again." };
  }
  return {
    kind: "network",
    message: "Could not reach makesPDF. Check your connection and try again.",
  };
}
