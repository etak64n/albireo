import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageConfig } from "../server/config.ts";
import { buildCompleteMultipartUploadXml, objectUrl, readXmlElement, S3ObjectStore, StorageError } from "../server/storage.ts";

const storage: StorageConfig = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "albireo-videos",
  urlStyle: "path",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_request: Request) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A storage service on this machine that records each request and answers it with `answer`. */
async function storageServer(answer: { status: number; headers?: Record<string, string>; body?: string }) {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString() });
      response.writeHead(answer.status, answer.headers ?? {}).end(answer.body ?? "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { endpoint, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("objectUrl", () => {
  it("puts the bucket in the path", () => {
    expect(objectUrl(storage, "videos/abc/original.mp4").toString()).toBe(
      "https://s3.example.com/albireo-videos/videos/abc/original.mp4",
    );
  });

  it("puts the bucket in the hostname", () => {
    expect(objectUrl({ ...storage, urlStyle: "virtual-hosted" }, "videos/abc/original.mp4").toString()).toBe(
      "https://albireo-videos.s3.example.com/videos/abc/original.mp4",
    );
  });

  it("keeps the port of the endpoint", () => {
    expect(objectUrl({ ...storage, endpoint: "http://localhost:9000" }, "thumbnails/abc.jpg").toString()).toBe(
      "http://localhost:9000/albireo-videos/thumbnails/abc.jpg",
    );
  });

  it("follows the path of the endpoint", () => {
    const behindPath = { ...storage, endpoint: "https://storage.example.com/s3" };
    expect(objectUrl(behindPath, "videos/abc/original.mp4").toString()).toBe(
      "https://storage.example.com/s3/albireo-videos/videos/abc/original.mp4",
    );
  });
});

describe("writes", () => {
  it("sends a part as it arrives, with its length, an unsigned payload, and a signature, and returns its ETag", async () => {
    const server = await storageServer({ status: 200, headers: { etag: '"part-etag"' } });
    try {
      const store = new S3ObjectStore({ ...storage, endpoint: server.endpoint });
      const etag = await store.uploadPart("videos/abc/original.mp4", "upload-1", 2, streamOf("some bytes"), 10);
      expect(etag).toBe('"part-etag"');
      const [request] = server.received;
      expect(request).toMatchObject({ method: "PUT", url: "/albireo-videos/videos/abc/original.mp4?partNumber=2&uploadId=upload-1", body: "some bytes" });
      expect(request?.headers["content-length"]).toBe("10");
      expect(request?.headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
      expect(request?.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 /);
    } finally {
      await server.close();
    }
  });

  it("writes an object with its content type", async () => {
    const server = await storageServer({ status: 200 });
    try {
      const store = new S3ObjectStore({ ...storage, endpoint: server.endpoint });
      await store.putObject("thumbnails/abc.jpg", "image/jpeg", streamOf("jpeg"), 4);
      expect(server.received[0]).toMatchObject({ method: "PUT", url: "/albireo-videos/thumbnails/abc.jpg", body: "jpeg" });
      expect(server.received[0]?.headers["content-type"]).toBe("image/jpeg");
    } finally {
      await server.close();
    }
  });

  it("reports what the bucket refused, with its code", async () => {
    const server = await storageServer({ status: 403, body: "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>" });
    try {
      const store = new S3ObjectStore({ ...storage, endpoint: server.endpoint });
      const write = store.putObject("thumbnails/abc.jpg", "image/jpeg", streamOf("jpeg"), 4);
      await expect(write).rejects.toThrow(new StorageError("PutObject failed with HTTP 403 (AccessDenied: Access Denied).", 403, "AccessDenied"));
      await expect(write).rejects.toMatchObject({ status: 403, code: "AccessDenied" });
    } finally {
      await server.close();
    }
  });

  it("stops a body that is shorter than its length before the bucket takes it", async () => {
    const server = await storageServer({ status: 200 });
    try {
      const store = new S3ObjectStore({ ...storage, endpoint: server.endpoint });
      await expect(store.putObject("thumbnails/abc.jpg", "image/jpeg", streamOf("jp"), 4)).rejects.toBeInstanceOf(StorageError);
    } finally {
      await server.close();
    }
  });

  it("reports a storage service that cannot be reached as a storage failure", async () => {
    const server = await storageServer({ status: 200 });
    await server.close();
    const store = new S3ObjectStore({ ...storage, endpoint: server.endpoint });
    const write = store.putObject("thumbnails/abc.jpg", "image/jpeg", streamOf("jpeg"), 4);
    await expect(write).rejects.toThrow(/^PutObject could not reach the storage service at http:\/\/127\.0\.0\.1:\d+: /);
    await expect(write).rejects.toMatchObject({ status: null });
  });
});

describe("reads", () => {
  it("passes the range and the validators of the browser on to the bucket, and its answer back", async () => {
    const fetchMock = stubFetch(new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/10" } }));
    const headers = new Headers({ range: "bytes=0-2", "if-none-match": '"x"', cookie: "secret", "user-agent": "browser" });
    const answer = await new S3ObjectStore(storage).getObject("videos/abc/original.mp4", "GET", headers);
    expect(answer?.status).toBe(206);
    expect(await answer?.text()).toBe("abc");
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request?.headers.get("range")).toBe("bytes=0-2");
    expect(request?.headers.get("if-none-match")).toBe('"x"');
    expect(request?.headers.get("cookie")).toBeNull();
  });

  it("returns null for an object that the bucket does not hold", async () => {
    stubFetch(new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }));
    await expect(new S3ObjectStore(storage).getObject("videos/abc/original.mp4", "GET", new Headers())).resolves.toBeNull();
  });

  it("passes on a revalidation and a range past the end", async () => {
    for (const status of [304, 416]) {
      stubFetch(new Response(null, { status }));
      expect((await new S3ObjectStore(storage).getObject("videos/abc/original.mp4", "GET", new Headers()))?.status).toBe(status);
    }
  });

  it("reports other answers as storage failures", async () => {
    stubFetch(new Response("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", { status: 403 }));
    await expect(new S3ObjectStore(storage).getObject("videos/abc/original.mp4", "GET", new Headers())).rejects.toThrow(
      new StorageError("GetObject failed with HTTP 403 (AccessDenied: Access Denied).", 403, "AccessDenied"),
    );
  });
});

describe("other requests", () => {
  it("starts a multipart upload and reads its upload ID", async () => {
    const fetchMock = stubFetch(
      new Response("<InitiateMultipartUploadResult><UploadId>abc&amp;123</UploadId></InitiateMultipartUploadResult>"),
    );
    const uploadId = await new S3ObjectStore(storage).createMultipartUpload("videos/abc/original.mp4", "video/mp4");
    expect(uploadId).toBe("abc&123");
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://s3.example.com/albireo-videos/videos/abc/original.mp4?uploads");
    expect(request?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("reports an error that the storage service returns with 200 OK", async () => {
    stubFetch(new Response("<Error><Code>InvalidPart</Code><Message>A part could not be found.</Message></Error>"));
    const store = new S3ObjectStore(storage);
    await expect(
      store.completeMultipartUpload("videos/abc/original.mp4", "upload-1", [{ partNumber: 1, etag: '"etag-1"' }]),
    ).rejects.toThrow(new StorageError("CompleteMultipartUpload failed with HTTP 200 (InvalidPart: A part could not be found.).", 200, "InvalidPart"));
  });

  it("reports a storage service that cannot be reached as a storage failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:9000") });
    }));
    await expect(new S3ObjectStore(storage).createMultipartUpload("videos/abc/original.mp4", "video/mp4")).rejects.toThrow(
      new StorageError(
        "CreateMultipartUpload could not reach the storage service at https://s3.example.com: fetch failed (connect ECONNREFUSED 127.0.0.1:9000)",
      ),
    );
  });

  it("returns null for a missing object", async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(new S3ObjectStore(storage).headObject("thumbnails/abc.jpg")).resolves.toBeNull();
  });

  it("reads the size of an object", async () => {
    stubFetch(new Response(null, { status: 200, headers: { "content-length": "2048" } }));
    await expect(new S3ObjectStore(storage).headObject("thumbnails/abc.jpg")).resolves.toEqual({ size: 2048 });
  });

  it("deletes an object with a signed DELETE", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await new S3ObjectStore(storage).deleteObject("attachments/abc/def");
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request?.method).toBe("DELETE");
    expect(request?.url).toBe("https://s3.example.com/albireo-videos/attachments/abc/def");
    expect(request?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("deletes a key that holds no object, which some services answer with 404", async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(new S3ObjectStore(storage).deleteObject("thumbnails/abc.jpg")).resolves.toBeUndefined();
  });

  it("reports a key that may not delete objects", async () => {
    stubFetch(new Response("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", { status: 403 }));
    await expect(new S3ObjectStore(storage).deleteObject("thumbnails/abc.jpg")).rejects.toThrow(
      new StorageError("DeleteObject failed with HTTP 403 (AccessDenied: Access Denied).", 403, "AccessDenied"),
    );
  });
});

describe("XML", () => {
  it("lists the parts in order when completing an upload", () => {
    expect(buildCompleteMultipartUploadXml([{ partNumber: 2, etag: '"b"' }, { partNumber: 1, etag: '"a&"' }])).toBe(
      '<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
        + '<Part><PartNumber>1</PartNumber><ETag>"a&amp;"</ETag></Part>'
        + '<Part><PartNumber>2</PartNumber><ETag>"b"</ETag></Part>'
        + "</CompleteMultipartUpload>",
    );
  });

  it("reads and unescapes an element", () => {
    expect(readXmlElement("<Result><Key>a&lt;b</Key></Result>", "Key")).toBe("a<b");
    expect(readXmlElement("<Result/>", "Key")).toBeNull();
  });
});
