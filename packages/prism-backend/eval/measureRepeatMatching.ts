// Measures how well repeat-visitor matching tells "same visitor" from
// "different visitor", with live Bedrock calls, so the thresholds
// (REPEAT_VISITOR_SIMILARITY_THRESHOLD, REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD)
// are chosen from data rather than guessed.
//
// Each sample snapshot is classified twice. "Same visitor" pairs are the two
// classifications of one snapshot: they show how much the model's wording
// drifts between runs. "Different visitor" pairs are every pair of different
// snapshots. Text similarity is measured on the visitor signature (what
// matching uses) and on the description (what it used before signatures);
// image similarity, when an image embedding model is configured, on the
// snapshots themselves.
//
// The sample photos have different backgrounds, while every frame from a
// real doorbell camera shares one, so the image numbers for different
// visitors here are a lower bound on how alike two visitors can look.
//
// Usage: npm run eval:repeat --workspace=prism-backend
// (live Bedrock: two classifications and two text embeddings per sample,
// plus one image embedding per sample when image embeddings are on)

import path from "node:path";
import { pathToFileURL } from "node:url";
import { embedDescription, embedImage, isImageEmbeddingEnabled } from "../src/bedrock/embeddings";
import { classifySnapshot, loadSnapshotBytes, type SnapshotClassification } from "../src/bedrock/multimodalContext";
import { loadEnv } from "../src/loadEnv";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

// Several people on purpose: different people with similar clothes are the
// pairs most likely to be confused.
const SAMPLE = [
  "person-front-door-daylight",
  "person-delivery-holding-box",
  "person-night-lowlight",
  "person-group-of-two",
  "person-walking-away",
  "package-doorstep-daylight",
  "package-small-envelope",
  "animal-cat-on-porch",
  "animal-dog-walking-by",
  "vehicle-car-parked-driveway",
];

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface Separation {
  sameMin: number;
  sameMean: number;
  differentMax: number;
  differentMean: number;
  /** Midpoint between the two groups, or null when they overlap. */
  suggestedThreshold: number | null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** How cleanly a threshold can split same-visitor from different-visitor similarities. */
export function separation(same: number[], different: number[]): Separation {
  const sameMin = Math.min(...same);
  const differentMax = Math.max(...different);
  return {
    sameMin,
    sameMean: mean(same),
    differentMax,
    differentMean: mean(different),
    suggestedThreshold: sameMin > differentMax ? Math.round(((sameMin + differentMax) / 2) * 100) / 100 : null,
  };
}

interface Sample {
  fixture: string;
  runs: [SnapshotClassification, SnapshotClassification];
  signatureEmbeddings: [number[], number[]];
  descriptionEmbeddings: [number[], number[]];
  imageEmbedding?: number[];
}

function report(label: string, same: number[], different: Array<{ pair: string; value: number }>): void {
  const result = separation(
    same,
    different.map((entry) => entry.value),
  );
  console.log(`\n${label}`);
  console.log(`  same visitor (re-described): min ${result.sameMin.toFixed(3)}  mean ${result.sameMean.toFixed(3)}  (n=${same.length})`);
  console.log(
    `  different visitors:          max ${result.differentMax.toFixed(3)}  mean ${result.differentMean.toFixed(3)}  (n=${different.length})`,
  );
  console.log(
    result.suggestedThreshold === null
      ? "  -> the two groups overlap; no single threshold separates them on this sample"
      : `  -> separable; suggested threshold ${result.suggestedThreshold.toFixed(2)}`,
  );
  const closest = [...different].sort((a, b) => b.value - a.value).slice(0, 3);
  console.log(`  most alike different visitors: ${closest.map((entry) => `${entry.pair} ${entry.value.toFixed(3)}`).join("; ")}`);
}

async function main(): Promise<void> {
  loadEnv();
  const imagesOn = isImageEmbeddingEnabled();
  console.log(`Measuring repeat-visitor matching on ${SAMPLE.length} snapshots (image embeddings ${imagesOn ? "on" : "off"})...`);

  const samples: Sample[] = [];
  let imageError: unknown;
  for (const fixture of SAMPLE) {
    const snapshotUrl = pathToFileURL(path.join(FIXTURES_DIR, `${fixture}.jpg`)).href;
    // Sequential, like the main eval, to stay well under Bedrock rate limits.
    const first = await classifySnapshot(snapshotUrl);
    const second = await classifySnapshot(snapshotUrl);
    const runs: [SnapshotClassification, SnapshotClassification] = [first, second];
    const signatureEmbeddings: [number[], number[]] = [
      await embedDescription(first.visitorSignature ?? first.description),
      await embedDescription(second.visitorSignature ?? second.description),
    ];
    const descriptionEmbeddings: [number[], number[]] = [
      await embedDescription(first.description),
      await embedDescription(second.description),
    ];
    let imageEmbedding: number[] | undefined;
    if (imagesOn && imageError === undefined) {
      try {
        imageEmbedding = await embedImage((await loadSnapshotBytes(snapshotUrl)).bytes);
      } catch (err) {
        imageError = err;
      }
    }
    samples.push({ fixture, runs, signatureEmbeddings, descriptionEmbeddings, imageEmbedding });
    console.log(`  ${fixture}: "${first.visitorSignature ?? "(no signature)"}" | "${second.visitorSignature ?? "(no signature)"}"`);
  }

  const differentPairs: Array<[Sample, Sample]> = [];
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) differentPairs.push([samples[i], samples[j]]);
  }
  const pairName = (a: Sample, b: Sample) => `${a.fixture} vs ${b.fixture}`;

  report(
    "Visitor signature similarity (what matching uses)",
    samples.map((s) => cosineSimilarity(s.signatureEmbeddings[0], s.signatureEmbeddings[1])),
    differentPairs.map(([a, b]) => ({ pair: pairName(a, b), value: cosineSimilarity(a.signatureEmbeddings[0], b.signatureEmbeddings[0]) })),
  );
  report(
    "Description similarity (before visitor signatures)",
    samples.map((s) => cosineSimilarity(s.descriptionEmbeddings[0], s.descriptionEmbeddings[1])),
    differentPairs.map(([a, b]) => ({
      pair: pairName(a, b),
      value: cosineSimilarity(a.descriptionEmbeddings[0], b.descriptionEmbeddings[0]),
    })),
  );

  if (!imagesOn) {
    console.log("\nImage similarity: skipped (set BEDROCK_IMAGE_EMBEDDING_MODEL_ID, e.g. amazon.titan-embed-image-v1, to include it)");
  } else if (imageError !== undefined) {
    console.log("\nImage similarity: image embedding call failed -- check the model is enabled for this account and region:");
    console.log(imageError);
  } else {
    const different = differentPairs.map(([a, b]) => cosineSimilarity(a.imageEmbedding!, b.imageEmbedding!));
    const closest = differentPairs
      .map(([a, b], index) => ({ pair: pairName(a, b), value: different[index] }))
      .sort((x, y) => y.value - x.value)
      .slice(0, 3);
    console.log("\nSnapshot image similarity");
    console.log("  same snapshot: 1.000 by construction (the image embedding is deterministic)");
    console.log(`  different snapshots: max ${Math.max(...different).toFixed(3)}  mean ${mean(different).toFixed(3)}  (n=${different.length})`);
    console.log(`  most alike different snapshots: ${closest.map((entry) => `${entry.pair} ${entry.value.toFixed(3)}`).join("; ")}`);
    console.log("  -> keep REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD well above that max; a real camera's shared background pushes it higher");
  }
  console.log();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Measurement failed:", err);
    process.exitCode = 1;
  });
}
