import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageConfig } from "../worker/runtime-config.ts";
import { buildCompleteMultipartUploadXml, objectUrl, readXmlElement, S3ObjectStore, StorageError } from "../worker/storage.ts";

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

  it("follows the path of the endpoint, as the local API of cf dev has", () => {
    const local = { ...storage, endpoint: "http://localhost:5173/cdn-cgi/local/r2/s3" };
    expect(objectUrl(local, "videos/abc/original.mp4").toString()).toBe(
      "http://localhost:5173/cdn-cgi/local/r2/s3/albireo-videos/videos/abc/original.mp4",
    );
  });
});

describe("signed URLs", () => {
  it("signs a GET that expires after the configured lifetime", async () => {
    const url = new URL(await new S3ObjectStore(storage, 3600).presignGet("videos/abc/original.mp4"));
    expect(`${url.origin}${url.pathname}`).toBe("https://s3.example.com/albireo-videos/videos/abc/original.mp4");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs the content type of a PUT, so the upload must send that type", async () => {
    const url = new URL(await new S3ObjectStore(storage, 600).presignPut("thumbnails/abc.jpg", "image/jpeg"));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
  });

  it("signs one part of a multipart upload", async () => {
    const url = new URL(await new S3ObjectStore(storage, 600).presignUploadPart("videos/abc/original.mp4", "upload-1", 3));
    expect(url.searchParams.get("partNumber")).toBe("3");
    expect(url.searchParams.get("uploadId")).toBe("upload-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  });
});

describe("S3ObjectStore requests", () => {
  it("starts a multipart upload and reads its upload ID", async () => {
    const fetchMock = stubFetch(
      new Response("<InitiateMultipartUploadResult><UploadId>abc&amp;123</UploadId></InitiateMultipartUploadResult>"),
    );
    const uploadId = await new S3ObjectStore(storage, 600).createMultipartUpload("videos/abc/original.mp4", "video/mp4");
    expect(uploadId).toBe("abc&123");
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://s3.example.com/albireo-videos/videos/abc/original.mp4?uploads");
    expect(request?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("reports an error that the storage service returns with 200 OK", async () => {
    stubFetch(new Response("<Error><Code>InvalidPart</Code><Message>A part could not be found.</Message></Error>"));
    const store = new S3ObjectStore(storage, 600);
    await expect(
      store.completeMultipartUpload("videos/abc/original.mp4", "upload-1", [{ partNumber: 1, etag: '"etag-1"' }]),
    ).rejects.toThrow(new StorageError("CompleteMultipartUpload failed with HTTP 200 (InvalidPart: A part could not be found.)."));
  });

  it("reports a storage service that cannot be reached as a storage failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await expect(
      new S3ObjectStore(storage, 600).createMultipartUpload("videos/abc/original.mp4", "video/mp4"),
    ).rejects.toThrow(
      new StorageError("CreateMultipartUpload could not reach the storage service at https://s3.example.com: fetch failed"),
    );
  });

  it("returns null for a missing object", async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(new S3ObjectStore(storage, 600).headObject("thumbnails/abc.jpg")).resolves.toBeNull();
  });

  it("reads the size of an object", async () => {
    stubFetch(new Response(null, { status: 200, headers: { "content-length": "2048" } }));
    await expect(new S3ObjectStore(storage, 600).headObject("thumbnails/abc.jpg")).resolves.toEqual({ size: 2048 });
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
