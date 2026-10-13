/**
 * The adapter registry: first factory whose `matches` accepts the URL wins.
 * MAK-197's later adapters are additive here — nothing else changes.
 */

import { githubAdapterFactory } from "./github";
import type { AdapterContext, AdapterFactory, MarkdownAdapter } from "./types";

export const ADAPTER_FACTORIES: readonly AdapterFactory[] = [githubAdapterFactory];

/** The adapter for a page, or null when no factory matches. */
export function findAdapter(context: AdapterContext): MarkdownAdapter | null {
  const factory = ADAPTER_FACTORIES.find((candidate) => candidate.matches(context.url));
  return factory ? factory.create(context) : null;
}
