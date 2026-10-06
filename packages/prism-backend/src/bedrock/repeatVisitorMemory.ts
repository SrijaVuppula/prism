// Wires Bedrock embeddings + pgvector similarity search into a single
// repeat-visitor lookup for the orchestration pipeline. Needs the
// classification result first (it embeds the visitor signature Bedrock
// produced -- a short, consistent list of the subject's traits -- falling
// back to the description when there is none),
// which is why this runs as a step after classifySnapshot() inside
// agentOrchestration.ts rather than being folded into scoring.ts itself --
// prism-alert-engine has no Ring/Postgres/Bedrock dependencies and this
// lookup needs all three.

import { randomUUID } from "node:crypto";
import type { PrismEvent } from "prism-alert-engine";
import { embedDescription, embedImage, isImageEmbeddingEnabled } from "./embeddings";
import { loadSnapshotBytes, type SnapshotClassification } from "./multimodalContext";
import {
  countVisitorGroupOccurrences,
  findSimilarEvent,
  getSessionWindowMs,
  recordEventEmbedding,
} from "../db/vectorStore";
import { getKnownVisitorTagStore } from "../db/knownVisitorTagStore";

export interface RepeatVisitorResult {
  /** Matches within the current session window (see db/vectorStore.ts). 0 for a first-time visit. */
  repeatVisitCount: number;
  /** Opt-in known-face match only -- see docs/ACCESSIBILITY.md's privacy note. */
  isKnownVisitor: boolean;
  /** Stable cluster id this event was grouped under, for the companion app's opt-in tagging UI. */
  visitorGroupId: string;
}

/**
 * Snapshot embedding for image matching, when an image embedding model is
 * configured. Best-effort: a failure (model not enabled in this account or
 * region, snapshot unavailable) logs and matching continues on the text
 * signal alone.
 */
async function embedSnapshotForMatching(event: PrismEvent): Promise<number[] | undefined> {
  if (!isImageEmbeddingEnabled()) return undefined;
  try {
    const { bytes } = await loadSnapshotBytes(event.snapshotUrl);
    return await embedImage(bytes);
  } catch (err) {
    console.error(`[repeat-visitor] image embedding failed for event ${event.id}, matching on text only:`, err);
    return undefined;
  }
}

/**
 * Embeds the event's visitor signature (and, when enabled, its snapshot),
 * looks for a matching recent event on the same device, and records this
 * event's own embeddings under whichever visitor group applies (existing
 * match, or a freshly minted one) so the chain keeps extending for the next
 * event.
 *
 * `knownVisitorTaggingEnabled` gates isKnownVisitor entirely: even a
 * high-confidence repeat match never sets it unless the household has
 * opted in (preferences/preferencesStore.ts) -- repeatVisitCount is the
 * only signal that's ever on by default, since it doesn't persist an
 * identity, just a same-session repetition count.
 */
export async function resolveRepeatVisitor(
  event: PrismEvent,
  classification: SnapshotClassification,
  knownVisitorTaggingEnabled: boolean,
): Promise<RepeatVisitorResult> {
  const deviceId = event.deviceId;
  if (!deviceId) {
    // No device to scope a session window to (e.g. a synthetic/eval event) --
    // there's nothing to look up, so this is a first-time, unknown visit.
    return { repeatVisitCount: 0, isKnownVisitor: false, visitorGroupId: randomUUID() };
  }

  const windowStart = new Date(new Date(event.occurredAt).getTime() - getSessionWindowMs());
  const embedding = await embedDescription(classification.visitorSignature ?? classification.description);
  const imageEmbedding = await embedSnapshotForMatching(event);
  const match = await findSimilarEvent({ text: embedding, image: imageEmbedding }, deviceId, windowStart);
  const visitorGroupId = match?.visitorGroupId ?? randomUUID();

  await recordEventEmbedding({ eventId: event.id, deviceId, embedding, imageEmbedding, visitorGroupId });

  if (!match) {
    return { repeatVisitCount: 0, isKnownVisitor: false, visitorGroupId };
  }

  console.log(
    `[repeat-visitor] event=${event.id} repeats=${match.eventId} by=${match.matchedBy} ` +
      `text=${match.textSimilarity.toFixed(3)} image=${match.imageSimilarity?.toFixed(3) ?? "n/a"}`,
  );

  const repeatVisitCount = await countVisitorGroupOccurrences(visitorGroupId, deviceId, windowStart);

  let isKnownVisitor = false;
  if (knownVisitorTaggingEnabled) {
    const tag = await getKnownVisitorTagStore().find(visitorGroupId);
    isKnownVisitor = tag !== null;
  }

  return { repeatVisitCount, isKnownVisitor, visitorGroupId };
}
