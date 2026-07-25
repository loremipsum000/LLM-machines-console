import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import type { Readable } from "node:stream"
import { Client as MinioClient } from "minio"

export interface KnowledgeObjectStoreConfig {
  endPoint: string
  port: number
  useSSL: boolean
  accessKey: string
  secretKey: string
  bucket: string
}

export interface KnowledgeObjectStoreClient {
  bucketExists(bucketName: string): Promise<boolean>
  makeBucket(bucketName: string): Promise<void>
  putObject(
    bucketName: string,
    objectName: string,
    stream: Buffer | string,
    size?: number,
    metaData?: Record<string, string>,
  ): Promise<unknown>
  presignedGetObject(
    bucketName: string,
    objectName: string,
    expires?: number,
  ): Promise<string>
  getObject(
    bucketName: string,
    objectName: string,
  ): Promise<Readable | Buffer | string>
  removeObject(bucketName: string, objectName: string): Promise<void>
}

export interface StoreKnowledgeObjectInput {
  objectKey: string
  body: Buffer | string
  contentType: string
}

export interface StoredKnowledgeObject {
  bucket: string
  objectKey: string
  checksum: string
  sizeBytes: number
  contentType: string
}

export interface PublicKnowledgeObjectRef {
  objectKey: string
  checksum: string
  sizeBytes: number
  contentType: string
}

export class KnowledgeObjectStore {
  constructor(
    private readonly client: KnowledgeObjectStoreClient,
    private readonly bucket: string,
  ) {}

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket)
    if (!exists) {
      await this.client.makeBucket(this.bucket)
    }
  }

  async putObject(
    input: StoreKnowledgeObjectInput,
  ): Promise<StoredKnowledgeObject> {
    const body = toBuffer(input.body)
    const checksum = sha256(body)
    await this.client.putObject(
      this.bucket,
      input.objectKey,
      body,
      body.length,
      {
        "Content-Type": input.contentType,
        "X-Amz-Meta-Sha256": checksum,
      },
    )

    return {
      bucket: this.bucket,
      objectKey: input.objectKey,
      checksum,
      sizeBytes: body.length,
      contentType: input.contentType,
    }
  }

  async presignedGetUrl(
    objectKey: string,
    expiresSeconds = 300,
  ): Promise<string> {
    return this.client.presignedGetObject(
      this.bucket,
      objectKey,
      expiresSeconds,
    )
  }

  async getObjectBuffer(objectKey: string): Promise<Buffer> {
    return streamToBuffer(await this.client.getObject(this.bucket, objectKey))
  }

  async removeObject(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey)
  }
}

export function createKnowledgeObjectStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeObjectStore {
  const config = getKnowledgeObjectStoreConfig(env)
  const client = new MinioClient({
    endPoint: config.endPoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  })
  return new KnowledgeObjectStore(client, config.bucket)
}

export function getKnowledgeObjectStoreConfig(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeObjectStoreConfig {
  const port = Number.parseInt(env.MINIO_PORT ?? "9000", 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("MINIO_PORT must be an integer TCP port.")
  }

  const config = {
    endPoint: requireEnv(env, "MINIO_ENDPOINT"),
    port,
    useSSL: (env.MINIO_USE_SSL ?? "false") === "true",
    accessKey: requireEnv(env, "MINIO_ACCESS_KEY"),
    secretKey: requireEnv(env, "MINIO_SECRET_KEY"),
    bucket: requireEnv(env, "KNOWLEDGE_MINIO_BUCKET"),
  }

  if (config.bucket.length < 3) {
    throw new Error("KNOWLEDGE_MINIO_BUCKET must be at least 3 characters.")
  }

  return config
}

export function toPublicKnowledgeObjectRef(
  object: StoredKnowledgeObject,
): PublicKnowledgeObjectRef {
  return {
    objectKey: object.objectKey,
    checksum: object.checksum,
    sizeBytes: object.sizeBytes,
    contentType: object.contentType,
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) {
    throw new Error(`${name} is required for knowledge object storage.`)
  }
  return value
}

function toBuffer(input: Buffer | string): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input)
}

async function streamToBuffer(
  input: Readable | Buffer | string,
): Promise<Buffer> {
  if (Buffer.isBuffer(input) || typeof input === "string") {
    return toBuffer(input)
  }

  const chunks: Buffer[] = []
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function sha256(input: Buffer): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`
}
