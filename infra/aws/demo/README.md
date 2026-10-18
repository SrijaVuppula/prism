# Public demo on AWS

[`prism-demo.yaml`](prism-demo.yaml) is a CloudFormation template that runs
Prism as a public demo: the backend, Postgres and the companion app on one
EC2 instance, behind CloudFront for HTTPS. Events come from the simulator
and the app's **Send a test visitor** button; no Ring account is linked.

## What it creates

- **EC2 instance** (Ubuntu 24.04, `t3.small`, 20 GB encrypted gp3 disk) in
  the region's default VPC. On first boot it checks out this repository and
  runs [`deploy.sh`](deploy.sh), which installs Node.js 22 and Docker, starts
  Postgres (pgvector), builds the backend and companion app, and runs them
  as the `prism` systemd service on port 3000.
- **Instance role** with `bedrock:InvokeModel` on Claude Haiku 4.5 (through
  the US inference profile) and Titan Text Embeddings V2, the same grant as
  [`../bedrock-invoke-policy.json`](../bedrock-invoke-policy.json), plus
  Session Manager access. No AWS keys are stored on the instance.
- **Security group** that opens port 3000 to CloudFront's origin-facing
  addresses only. There's no SSH port; use Session Manager.
- **Elastic IP**, so CloudFront's origin keeps its address if the instance
  is stopped and started.
- **CloudFront distribution** with an HTTPS `*.cloudfront.net` address.
  The API, the WebSocket stream and `index.html` are never cached. The
  app's fingerprinted build files under `/assets/` are cached and
  compressed.

The stack finishes only after the app is running and has classified its
first simulated events with Amazon Bedrock. If that fails, the stack rolls
back and its events show the last lines of the deploy log.

## Before you deploy

- The AWS CLI, signed in to the account that will run the demo.
- The account has already called Claude Haiku 4.5 on Amazon Bedrock once,
  which completes Anthropic's use case form and the Marketplace
  subscription (see [`../README.md`](../README.md#model-access)). The
  instance role can't do that first call itself.
- A default VPC in the region (accounts have one unless it was deleted).
- Your changes pushed: the instance deploys from GitHub, not from your
  machine.

## Deploy

The commands use `us-east-2`, the region Prism calls Bedrock in.

1. Look up CloudFront's origin-facing prefix list for the region:

   ```sh
   PREFIX_LIST=$(aws ec2 describe-managed-prefix-lists --region us-east-2 \
     --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
     --query 'PrefixLists[0].PrefixListId' --output text)
   echo "$PREFIX_LIST"
   ```

2. Create the stack. This takes about 15 minutes:

   ```sh
   aws cloudformation deploy --region us-east-2 --stack-name prism-demo \
     --template-file infra/aws/demo/prism-demo.yaml \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides CloudFrontPrefixListId="$PREFIX_LIST"
   ```

3. Get the demo's address:

   ```sh
   aws cloudformation describe-stacks --region us-east-2 --stack-name prism-demo \
     --query "Stacks[0].Outputs[?OutputKey=='DemoUrl'].OutputValue" --output text
   ```

Optional parameters: `HouseholdTimeZone` (default `America/Los_Angeles`),
`TestVisitorDailyLimit` (default 300) and `CatchUpDailyLimit` (default 200),
which cap the two buttons that call Bedrock per UTC day, `InstanceType`,
`RepositoryUrl` and `GitRef`.

### If the stack fails

Read the reason, which ends with the last lines of the deploy log:

```sh
aws cloudformation describe-stack-events --region us-east-2 --stack-name prism-demo \
  --query "StackEvents[?LogicalResourceId=='DeployWaitCondition'].ResourceStatusReason" --output text
```

A stack that failed on creation has to be deleted (see below) before
deploying it again.

## Update to the latest commit

Push first, then pull and redeploy on the instance with Systems Manager.
`deploy.sh` keeps the database, the generated secrets and the household's
settings:

```sh
aws ssm send-command --region us-east-2 --document-name AWS-RunShellScript \
  --targets Key=tag:Name,Values=prism-demo \
  --parameters 'commands=["sudo -u prism git -C /opt/prism pull --ff-only","bash /opt/prism/infra/aws/demo/deploy.sh"]'
```

## On the instance

Connect with Session Manager, from the EC2 console (**Connect**, then
**Session Manager**) or with
`aws ssm start-session --region us-east-2 --target <InstanceId>`, which needs
the Session Manager plugin for the AWS CLI.

- Service logs: `journalctl -u prism -f`
- First-boot log: `/var/log/prism-deploy.log`
- The backend's settings: `/etc/prism.env`, then
  `/opt/prism/packages/prism-backend/.env` (generated on the instance by
  `npm run init-env`, with a webhook signing secret and VAPID key pair that
  never leave it).

## What's public

- Everyone who opens the address shares one household: the same alerts,
  settings and catch-up. The app shows a note saying so.
- The household's preferences start with quiet hours from 10 PM to 7 AM
  and known-visitor tagging off.
- `POST /webhooks/ring` rejects any request that isn't signed with the
  instance's own secret.
- Ring account linking stays off, since `RING_LINK_PASSCODE` isn't set.
- History is deleted after 30 days, as on any Prism server.
- CloudFront reaches the instance over plain HTTP on port 3000, which only
  CloudFront's addresses can reach. A real household's server should use
  HTTPS to the origin too, for example through a load balancer with an ACM
  certificate.

## Cost

In `us-east-2`, roughly $20 a month: the `t3.small` instance (about $15),
the public IPv4 address (about $3.60) and the disk (about $1.60). CloudFront
and Bedrock add little at demo traffic: each test visitor is one Claude
Haiku 4.5 call with an image and one Titan embedding, and the daily caps
limit both buttons. Check the AWS pricing pages for current rates.

## Delete

```sh
aws cloudformation delete-stack --region us-east-2 --stack-name prism-demo
```

This deletes the instance, its disk and everything stored on it.
