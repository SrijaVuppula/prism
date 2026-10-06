// Keeps infra/aws/bedrock-invoke-policy.json in step with the models and
// region the backend is configured with in .env.example, and checks it stays
// least-privilege.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

interface Statement {
  Sid: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string>>;
}

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const policy = JSON.parse(readFileSync(path.join(repoRoot, "infra", "aws", "bedrock-invoke-policy.json"), "utf8")) as {
  Version: string;
  Statement: Statement[];
};
const example = parse(readFileSync(path.join(repoRoot, "packages", "prism-backend", ".env.example"), "utf8"));

const region = example.BEDROCK_REGION;
const profileArn = `arn:aws:bedrock:${region}:<ACCOUNT_ID>:inference-profile/${example.BEDROCK_MODEL_ID}`;

function resources(statement: Statement): string[] {
  return Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
}

describe("infra/aws/bedrock-invoke-policy.json", () => {
  it("grants only bedrock:InvokeModel", () => {
    expect(policy.Version).toBe("2012-10-17");
    for (const statement of policy.Statement) {
      expect(statement.Effect).toBe("Allow");
      expect(statement.Action).toBe("bedrock:InvokeModel");
      for (const resource of resources(statement)) expect(resource).not.toBe("*");
    }
  });

  it("covers the configured classification inference profile", () => {
    const allResources = policy.Statement.flatMap(resources);
    expect(allResources).toContain(profileArn);
  });

  it("allows the classification foundation model only through that profile", () => {
    const foundationModelId = example.BEDROCK_MODEL_ID.replace(/^us\./, "");
    const statement = policy.Statement.find((s) =>
      resources(s).includes(`arn:aws:bedrock:*::foundation-model/${foundationModelId}`),
    );
    expect(statement?.Condition).toEqual({ StringEquals: { "bedrock:InferenceProfileArn": profileArn } });
  });

  it("covers the configured embedding model in the configured region", () => {
    const allResources = policy.Statement.flatMap(resources);
    expect(allResources).toContain(`arn:aws:bedrock:${region}::foundation-model/${example.BEDROCK_EMBEDDING_MODEL_ID}`);
  });
});
