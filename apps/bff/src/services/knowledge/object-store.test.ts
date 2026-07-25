import { describe, expect, it } from "vitest"
import {
  getKnowledgeObjectStoreConfig,
  KnowledgeObjectStore,
  type KnowledgeObjectStoreClient,
  toPublicKnowledgeObjectRef,
} from "./object-store"

class FakeMinioClient implements KnowledgeObjectStoreClient {
  bucketCreated = false
  stored = new Map<string, Buffer>()

  async bucketExists(): Promise<boolean> {
    return this.bucketCreated
  }

  async makeBucket(): Promise<void> {
    this.bucketCreated = true
  }

  async putObject(
    bucketName: string,
    objectName: string,
    stream: Buffer | string,
  ): Promise<void> {
    this.stored.set(`${bucketName}/${objectName}`, Buffer.from(stream))
  }

  async presignedGetObject(
    bucketName: string,
    objectName: string,
  ): Promise<string> {
    return `http://minio.test/${bucketName}/${objectName}?X-Amz-Signature=fixture`
  }

  async getObject(bucketName: string, objectName: string): Promise<Buffer> {
    const object = this.stored.get(`${bucketName}/${objectName}`)
    if (!object) {
      throw new Error("missing object")
    }
    return object
  }

  async removeObject(bucketName: string, objectName: string): Promise<void> {
    this.stored.delete(`${bucketName}/${objectName}`)
  }
}

describe("KnowledgeObjectStore", () => {
  it("uploads an object, computes checksum, and creates presigned URLs", async () => {
    const client = new FakeMinioClient()
    const store = new KnowledgeObjectStore(client, "console-knowledge")

    await store.ensureBucket()
    const stored = await store.putObject({
      objectKey: "corpora/corpus-1/source.txt",
      body: "Governed corpus object",
      contentType: "text/plain",
    })
    const url = await store.presignedGetUrl(stored.objectKey)

    expect(client.bucketCreated).toBe(true)
    expect(
      client.stored.get("console-knowledge/corpora/corpus-1/source.txt"),
    ).toEqual(Buffer.from("Governed corpus object"))
    expect(stored.checksum).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(stored.sizeBytes).toBe(22)
    expect(url).toContain("X-Amz-Signature=fixture")
    await expect(store.getObjectBuffer(stored.objectKey)).resolves.toEqual(
      Buffer.from("Governed corpus object"),
    )
    await store.removeObject(stored.objectKey)
    await expect(store.getObjectBuffer(stored.objectKey)).rejects.toThrow(
      "missing object",
    )
  })

  it("does not expose MinIO credentials in public object refs", async () => {
    const store = new KnowledgeObjectStore(
      new FakeMinioClient(),
      "console-knowledge",
    )
    const stored = await store.putObject({
      objectKey: "corpora/corpus-1/source.txt",
      body: "private object",
      contentType: "text/plain",
    })

    const publicRef = toPublicKnowledgeObjectRef(stored)
    const serialized = JSON.stringify(publicRef)

    expect(publicRef).toEqual({
      objectKey: "corpora/corpus-1/source.txt",
      checksum: stored.checksum,
      sizeBytes: 14,
      contentType: "text/plain",
    })
    expect(serialized).not.toContain("accessKey")
    expect(serialized).not.toContain("secretKey")
    expect(serialized).not.toContain("MINIO")
    expect(serialized).not.toContain("console-knowledge")
  })

  it("parses MinIO configuration from environment variables", () => {
    expect(
      getKnowledgeObjectStoreConfig({
        MINIO_ENDPOINT: "localhost",
        MINIO_PORT: "9000",
        MINIO_USE_SSL: "false",
        MINIO_ACCESS_KEY: "console-dev",
        MINIO_SECRET_KEY: "console-dev-secret",
        KNOWLEDGE_MINIO_BUCKET: "console-knowledge",
      }),
    ).toEqual({
      endPoint: "localhost",
      port: 9000,
      useSSL: false,
      accessKey: "console-dev",
      secretKey: "console-dev-secret",
      bucket: "console-knowledge",
    })
  })
})
