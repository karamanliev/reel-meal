import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { MAX_IMAGE_BYTES, MAX_SOURCE_IMAGE_BYTES, MAX_SOURCE_IMAGES } from "./input.js";

export const ASSET_ROOT = join(tmpdir(), "reelmeal-assets");

export interface ManagedAsset {
  id: string;
  fileName: string;
  contentType: SupportedImageType;
  size: number;
  previewUrl: string;
}

export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const EXTENSIONS: Record<SupportedImageType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function sniffImage(buffer: Buffer): SupportedImageType | null {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9) return "image/jpeg";
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.subarray(12, 16).toString() === "IHDR") return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buffer.length >= 10 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString())) return "image/gif";
  return null;
}

export function normalizeFileName(name: string): string {
  const base = name.normalize("NFKC").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").trim();
  if (!base || base === "." || base === ".." || base.length > 180) throw new Error("Image filename cannot be safely normalized.");
  return base;
}

export function validateImageBuffer(params: { buffer: Buffer; declaredType: string; fileName: string }): SupportedImageType {
  const { buffer, declaredType, fileName } = params;
  normalizeFileName(fileName);
  if (buffer.length === 0) throw new Error(`${fileName} is empty.`);
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`${fileName} exceeds the 10 MB image limit.`);
  if (!(declaredType in EXTENSIONS)) throw new Error(`${fileName} has an unsupported image type.`);
  const detected = sniffImage(buffer);
  if (!detected) throw new Error(`${fileName} is corrupt or does not have a supported image signature.`);
  if (detected !== declaredType) throw new Error(`${fileName} MIME type does not match its file signature.`);
  return detected;
}

class AssetManager {
  async initialize(): Promise<void> {
    await rm(ASSET_ROOT, { recursive: true, force: true });
    await mkdir(ASSET_ROOT, { recursive: true, mode: 0o700 });
  }

  private jobDir(jobId: string): string {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(jobId)) throw new Error("Invalid job identifier.");
    return join(ASSET_ROOT, jobId);
  }

  async saveUploads(jobId: string, files: File[], role: "source" | "custom"): Promise<ManagedAsset[]> {
    if (role === "source") {
      if (files.length < 1 || files.length > MAX_SOURCE_IMAGES) throw new Error("Choose between 1 and 10 source images.");
      if (files.reduce((total, file) => total + file.size, 0) > MAX_SOURCE_IMAGE_BYTES) throw new Error("Source images exceed the 50 MB combined limit.");
    } else if (files.length > 1) {
      throw new Error("Only one custom recipe image is allowed.");
    }
    const dir = this.jobDir(jobId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const assets: ManagedAsset[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const contentType = validateImageBuffer({ buffer, declaredType: file.type, fileName: file.name });
      const id = `${role}-${randomUUID()}`;
      const safeName = normalizeFileName(file.name);
      await writeFile(join(dir, `${id}${EXTENSIONS[contentType]}`), buffer, { mode: 0o600 });
      assets.push({ id, fileName: safeName, contentType, size: buffer.length, previewUrl: `/api/assets/${jobId}/${id}` });
    }
    return assets;
  }

  async saveRemote(jobId: string, buffer: Buffer, contentType: string, label: string): Promise<ManagedAsset> {
    const type = validateImageBuffer({ buffer, declaredType: contentType.split(";")[0].trim(), fileName: label });
    const id = `remote-${randomUUID()}`;
    const dir = this.jobDir(jobId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, `${id}${EXTENSIONS[type]}`), buffer, { mode: 0o600 });
    return { id, fileName: normalizeFileName(label), contentType: type, size: buffer.length, previewUrl: `/api/assets/${jobId}/${id}` };
  }

  async resolve(jobId: string, assetId: string): Promise<{ path: string; contentType: SupportedImageType; size: number }> {
    if (!/^(source|custom|remote)-[a-f0-9-]{36}$/.test(assetId)) throw new Error("Invalid asset identifier.");
    const dir = this.jobDir(jobId);
    const files = await readdir(dir).catch(() => []);
    const file = files.find((name) => name.startsWith(`${assetId}.`));
    if (!file) throw new Error("Asset not found or no longer retained.");
    const path = resolve(dir, file);
    if (!path.startsWith(`${resolve(dir)}/`)) throw new Error("Invalid asset path.");
    const extension = extname(file).toLowerCase();
    const contentType = (Object.entries(EXTENSIONS).find(([, ext]) => ext === extension)?.[0] ?? null) as SupportedImageType | null;
    if (!contentType) throw new Error("Unsupported retained asset.");
    return { path, contentType, size: (await stat(path)).size };
  }

  async read(jobId: string, assetId: string): Promise<{ buffer: Buffer; path: string; contentType: SupportedImageType }> {
    const asset = await this.resolve(jobId, assetId);
    return { ...asset, buffer: await readFile(asset.path) };
  }

  cleanupJob(jobId: string): Promise<void> {
    return rm(this.jobDir(jobId), { recursive: true, force: true });
  }
}

export const assetManager = new AssetManager();
