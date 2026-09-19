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
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString())) return "image/gif";
  return null;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPng(buffer: Buffer): boolean {
  let offset = 8; let sawHeader = false; let sawData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset); const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataEnd = offset + 8 + length; const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) return false;
    if (buffer.readUInt32BE(dataEnd) !== crc32(buffer.subarray(offset + 4, dataEnd))) return false;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13 || buffer.readUInt32BE(offset + 8) === 0 || buffer.readUInt32BE(offset + 12) === 0) return false;
      sawHeader = true;
    }
    if (type === "IDAT") sawData = true;
    if (type === "IEND") return length === 0 && sawData && chunkEnd === buffer.length;
    offset = chunkEnd;
  }
  return false;
}

function validJpeg(buffer: Buffer): boolean {
  if (buffer.length < 10 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) return false;
  let offset = 2; let sawFrame = false;
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9) return sawFrame;
    if (marker === 0xda) return sawFrame;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return false;
    const isFrame = (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker));
    if (isFrame) {
      if (length < 7 || buffer.readUInt16BE(offset + 3) === 0 || buffer.readUInt16BE(offset + 5) === 0) return false;
      sawFrame = true;
    }
    offset += length;
  }
  return false;
}

function consumeGifBlocks(buffer: Buffer, start: number): number {
  let offset = start;
  while (offset < buffer.length) {
    const length = buffer[offset++];
    if (length === 0) return offset;
    if (offset + length > buffer.length) return -1;
    offset += length;
  }
  return -1;
}

function validGif(buffer: Buffer): boolean {
  if (buffer.length < 14 || buffer.readUInt16LE(6) === 0 || buffer.readUInt16LE(8) === 0) return false;
  let offset = 13; let sawImage = false;
  if (buffer[10] & 0x80) offset += 3 * (2 ** ((buffer[10] & 0x07) + 1));
  while (offset < buffer.length) {
    const block = buffer[offset++];
    if (block === 0x3b) return sawImage && offset === buffer.length;
    if (block === 0x21) {
      if (offset >= buffer.length) return false;
      offset = consumeGifBlocks(buffer, offset + 1);
    } else if (block === 0x2c) {
      if (offset + 9 > buffer.length || buffer.readUInt16LE(offset + 4) === 0 || buffer.readUInt16LE(offset + 6) === 0) return false;
      const packed = buffer[offset + 8]; offset += 9;
      if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
      if (offset >= buffer.length) return false;
      offset = consumeGifBlocks(buffer, offset + 1); sawImage = true;
    } else return false;
    if (offset < 0 || offset > buffer.length) return false;
  }
  return false;
}

function validWebp(buffer: Buffer): boolean {
  if (buffer.length < 20 || buffer.readUInt32LE(4) + 8 !== buffer.length) return false;
  let offset = 12; let sawImage = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii"); const length = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > buffer.length) return false;
    if (type === "VP8 " || type === "VP8L") sawImage = length >= 5;
    if (type === "ANMF") sawImage = length >= 16;
    offset = end + (length % 2);
  }
  return sawImage && offset === buffer.length;
}

function hasValidImageStructure(buffer: Buffer, type: SupportedImageType): boolean {
  if (type === "image/png") return validPng(buffer);
  if (type === "image/jpeg") return validJpeg(buffer);
  if (type === "image/gif") return validGif(buffer);
  return validWebp(buffer);
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
  if (!hasValidImageStructure(buffer, detected)) throw new Error(`${fileName} is corrupt or incomplete.`);
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
