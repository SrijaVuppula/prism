// Bedrock multimodal (Claude) call: snapshot + structured prompt -> classification.
//
// Fetches the snapshot, sends it to the configured Bedrock model as an image
// content block alongside a structured prompt, and parses the model's JSON
// reply into a ClassificationResult. Round-trip latency is logged on every
// call so the real-time claim is backed by a measured number, not a guess.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { Classifier, ClassificationResult, EventCategory } from "prism-alert-engine";
import { getBedrockConfig } from "./config";

export class BedrockClassificationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BedrockClassificationError";
  }
}

const ANTHROPIC_VERSION = "bedrock-2023-05-31";
const MAX_TOKENS = 300;
// Classification wants the same answer for the same snapshot: at the default
// temperature (1.0) the wording of the description and visitor signature
// varies between runs, which reads as a different visitor to repeat-visitor
// matching.
const TEMPERATURE = 0;

const VALID_CATEGORIES: ReadonlySet<string> = new Set<EventCategory>([
  "person",
  "package",
  "vehicle",
  "animal",
]);

const CLASSIFICATION_PROMPT = `You are looking at a single snapshot from a doorbell camera. Classify what
the camera captured and respond with nothing but a single JSON object, no
markdown fences and no extra text, matching this exact shape:

{"category": "person" | "package" | "vehicle" | "animal", "description": string, "visitorSignature": string, "confidence": number}

Rules:
- "category" must be exactly one of: person, package, vehicle, animal. If more
  than one is visible, choose whichever the shot is most clearly about.
- "description" is one plain-English sentence describing what's happening,
  written for someone who cannot see the image.
- "visitorSignature" lists the main subject's stable visible traits, so the
  same subject can be recognized in a later snapshot: lowercase,
  comma-separated, most distinctive first, at most 8 items. For a person:
  clothing items with their colors, headwear, hair, and anything carried. For
  a vehicle: color, body type, and any markings. For an animal: species,
  color, and markings. For a package: size, color, and any labels. Leave out
  the background, lighting, pose, and anything you can't see clearly.
- "confidence" is your confidence in the category, from 0 to 1.`;

/**
 * A classification plus the visitor signature repeat-visitor memory matches
 * on (repeatVisitorMemory.ts). The signature is backend-only and optional:
 * a reply without one still classifies, and matching falls back to the
 * description.
 */
export interface SnapshotClassification extends ClassificationResult {
  visitorSignature?: string;
}

let cachedClient: BedrockRuntimeClient | undefined;

function getClient(region: string): BedrockRuntimeClient {
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({ region });
  }
  return cachedClient;
}

function mediaTypeFromExtension(url: string): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg"; // Ring snapshots are JPEGs; safe default.
}

/**
 * Loads the snapshot's raw bytes. Supports plain http(s) URLs (the normal
 * case for a Ring snapshot_url) and file:// URLs, so local fixture images
 * -- e.g. for the eval harness in ../../eval -- don't need to be hosted
 * over HTTP to be classified. Also used by events/routes.ts to serve the
 * snapshot to the companion app.
 */
export async function loadSnapshotBytes(snapshotUrl: string): Promise<{ bytes: Buffer; mediaType: string }> {
  if (snapshotUrl.startsWith("file://")) {
    const bytes = await readFile(fileURLToPath(snapshotUrl));
    return { bytes, mediaType: mediaTypeFromExtension(snapshotUrl) };
  }

  let response: Response;
  try {
    response = await fetch(snapshotUrl);
  } catch (err) {
    throw new BedrockClassificationError(`Failed to fetch snapshot at ${snapshotUrl}`, err);
  }
  if (!response.ok) {
    throw new BedrockClassificationError(`Snapshot fetch returned ${response.status} for ${snapshotUrl}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type");
  const mediaType = contentType && contentType.startsWith("image/") ? contentType : mediaTypeFromExtension(snapshotUrl);
  return { bytes, mediaType };
}

/** Models occasionally wrap JSON in prose or a markdown code fence; pull the first {...} block out. */
function extractJsonObject(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function parseClassification(rawText: string): SnapshotClassification {
  const jsonText = extractJsonObject(rawText);
  let parsed: { category?: unknown; description?: unknown; visitorSignature?: unknown; confidence?: unknown };
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new BedrockClassificationError(`Model response was not valid JSON: ${rawText}`, err);
  }

  if (typeof parsed.category !== "string" || !VALID_CATEGORIES.has(parsed.category)) {
    throw new BedrockClassificationError(`Model returned an unrecognized category: ${String(parsed.category)}`);
  }
  if (typeof parsed.description !== "string" || parsed.description.length === 0) {
    throw new BedrockClassificationError("Model response is missing a description");
  }
  if (typeof parsed.confidence !== "number" || Number.isNaN(parsed.confidence)) {
    throw new BedrockClassificationError("Model response is missing a numeric confidence");
  }

  const signature =
    typeof parsed.visitorSignature === "string" ? parsed.visitorSignature.trim().toLowerCase() : "";

  return {
    category: parsed.category as EventCategory,
    description: parsed.description,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    ...(signature ? { visitorSignature: signature } : {}),
  };
}

export async function classifySnapshot(snapshotUrl: string): Promise<SnapshotClassification> {
  const { region, modelId } = getBedrockConfig();
  const { bytes, mediaType } = await loadSnapshotBytes(snapshotUrl);

  const body = JSON.stringify({
    anthropic_version: ANTHROPIC_VERSION,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") },
          },
          { type: "text", text: CLASSIFICATION_PROMPT },
        ],
      },
    ],
  });

  const client = getClient(region);
  const startedAt = Date.now();
  let response: InvokeModelCommandOutput;
  try {
    response = await client.send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body,
      }),
    );
  } catch (err) {
    throw new BedrockClassificationError(`Bedrock InvokeModel call failed for model ${modelId}`, err);
  } finally {
    console.log(`[bedrock] classifySnapshot model=${modelId} region=${region} latencyMs=${Date.now() - startedAt}`);
  }

  const payload = JSON.parse(Buffer.from(response.body).toString("utf8")) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock = payload.content?.find((block) => block.type === "text" && typeof block.text === "string");
  if (!textBlock?.text) {
    throw new BedrockClassificationError("Bedrock response did not contain a text content block");
  }

  return parseClassification(textBlock.text);
}

/** Satisfies the `Classifier` interface (prism-alert-engine/src/classifier.ts) so this can be swapped in for StubClassifier wherever a Classifier is expected. */
export class BedrockClassifier implements Classifier {
  async classify(snapshotUrl: string): Promise<ClassificationResult> {
    return classifySnapshot(snapshotUrl);
  }
}
