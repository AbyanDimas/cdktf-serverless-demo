import { Construct } from "constructs";
import { S3Bucket } from "@cdktf/provider-aws/lib/s3-bucket";
import { SqsQueue } from "@cdktf/provider-aws/lib/sqs-queue";
import { S3BucketLifecycleConfiguration } from "@cdktf/provider-aws/lib/s3-bucket-lifecycle-configuration";
import { S3BucketNotification } from "@cdktf/provider-aws/lib/s3-bucket-notification";
import { SqsQueuePolicy } from "@cdktf/provider-aws/lib/sqs-queue-policy";
import { TerraformOutput } from "cdktf";

export class Storage extends Construct {
  public readonly bucket: S3Bucket;
  public readonly queue: SqsQueue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.bucket = new S3Bucket(this, "lks_bucket", {
      bucket: "lks-abyandimas-tegal-jawatengah",
    });

    new S3BucketLifecycleConfiguration(this, "bucket_lifecycle", {
      bucket: this.bucket.bucket,
      rule: [
        {
          id: "proofOfPayment-lifecycle",
          status: "Enabled",
          filter: {
            prefix: "proofOfPayment/",
          } as any,
          transition: [
            {
              days: 180,
              storageClass: "DEEP_ARCHIVE",
            },
          ],
          expiration: {
            days: 365,
          } as any,
        },
      ],
    });

    this.queue = new SqsQueue(this, "payment_queue", {
      name: "payment-queue",
    });

    new S3BucketNotification(this, "bucket_notification", {
      bucket: this.bucket.id,
      queue: [
        {
          queueArn: this.queue.arn,
          events: ["s3:ObjectCreated:*"],
          filterPrefix: "proofOfPayment/",
        },
      ],
    });

    new SqsQueuePolicy(this, "sqs_policy", {
      queueUrl: this.queue.id,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: "sqs:SendMessage",
            Resource: this.queue.arn,
            Condition: {
              ArnEquals: { "aws:SourceArn": this.bucket.arn },
            },
          },
        ],
      }),
    });

    new TerraformOutput(this, "s3_bucket_name", {
      value: this.bucket.bucket,
    });

    new TerraformOutput(this, "s3_bucket_arn", {
      value: this.bucket.arn,
    });

    new TerraformOutput(this, "sqs_queue_url", {
      value: this.queue.id,
    });

    new TerraformOutput(this, "sqs_queue_arn", {
      value: this.queue.arn,
    });
  }
}

