# AWS setup

Prism's backend calls Amazon Bedrock for two things, both with
`bedrock:InvokeModel` and nothing else:

- **Snapshot classification** -- Claude Haiku 4.5 through the US
  cross-Region inference profile `us.anthropic.claude-haiku-4-5-20251001-v1:0`,
  called from `us-east-2` (`BEDROCK_REGION`, `BEDROCK_MODEL_ID`).
- **Repeat-visitor embeddings** -- Amazon Titan Text Embeddings V2,
  `amazon.titan-embed-text-v2:0`, in the same region
  (`BEDROCK_EMBEDDING_MODEL_ID`).

## Model access

Serverless Bedrock models no longer need to be enabled one by one on a
model access page; they're available in each region by default. Two
one-time steps remain for the Anthropic model:

1. **Use case details.** Anthropic asks each AWS account (or the
   organization's management account) for use case details once, before
   the first call. Open the Bedrock console in `us-east-2`, select Claude
   Haiku 4.5 in the model catalog, and submit the form.
2. **Marketplace subscription.** The first call to a third-party model sets
   up an AWS Marketplace subscription in the background, and the identity
   making that call needs `aws-marketplace:Subscribe`,
   `aws-marketplace:Unsubscribe` and `aws-marketplace:ViewSubscriptions`.
   Make that first call (for example `npm run eval --workspace=prism-backend`)
   with an administrator identity, so the backend's own identity never
   needs Marketplace permissions. Calls can return `AccessDeniedException`
   for a few minutes while the subscription completes.

If `npm run eval` already succeeds for the account, both are done.

## IAM policy

[`bedrock-invoke-policy.json`](bedrock-invoke-policy.json) is the
least-privilege policy for the identity the backend runs as:

- `bedrock:InvokeModel` on the inference profile in `us-east-2`.
- `bedrock:InvokeModel` on the Claude Haiku 4.5 foundation model in every
  region, but only when the call comes through that inference profile
  (`bedrock:InferenceProfileArn` condition). The profile routes each
  request to one of several US regions, and the caller needs permission on
  the model in whichever region serves it; the condition stops the model
  from being called directly or through any other profile. To see the
  regions the profile currently routes to:

  ```sh
  aws bedrock get-inference-profile --region us-east-2 \
    --inference-profile-identifier us.anthropic.claude-haiku-4-5-20251001-v1:0 \
    --query 'models[].modelArn'
  ```

- `bedrock:InvokeModel` on Titan Text Embeddings V2 in `us-east-2`.

No streaming, model management, Marketplace or other Bedrock actions are
granted.

The file has an `<ACCOUNT_ID>` placeholder. To create the policy with your
account ID filled in:

```sh
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed "s/<ACCOUNT_ID>/$ACCOUNT_ID/g" infra/aws/bedrock-invoke-policy.json > /tmp/prism-bedrock-policy.json
aws iam create-policy --policy-name PrismBedrockInvoke \
  --policy-document file:///tmp/prism-bedrock-policy.json
```

Then attach `arn:aws:iam::<ACCOUNT_ID>:policy/PrismBedrockInvoke` to the
IAM role or user the backend runs as. For a deployed backend, prefer a role
(an EC2 instance profile or ECS task role) so no access keys are stored.

## Credentials

The backend uses the AWS SDK's default credential chain -- environment
variables, the shared `~/.aws` config and credentials files, or an attached
role -- and never reads AWS keys from `packages/prism-backend/.env`. For
local development, configure a named profile with the AWS CLI
(`aws configure --profile prism`, or `aws configure sso --profile prism`)
and select it with `AWS_PROFILE=prism`, which can go in `.env` since it's
only a name.

## Optional: image embeddings

When `BEDROCK_IMAGE_EMBEDDING_MODEL_ID` is set (for example Amazon Titan
Multimodal Embeddings G1, `amazon.titan-embed-image-v1`), repeat-visitor
matching also embeds snapshots. That model is offered in fewer regions, so
check the model catalog and set `BEDROCK_IMAGE_EMBEDDING_REGION` if it isn't
in `us-east-2`. Add one more statement to the policy for it:

```json
{
  "Sid": "EmbedSnapshots",
  "Effect": "Allow",
  "Action": "bedrock:InvokeModel",
  "Resource": "arn:aws:bedrock:<IMAGE_EMBEDDING_REGION>::foundation-model/amazon.titan-embed-image-v1"
}
```
