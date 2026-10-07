/** Limit decoded bytes; accept raster signatures only, never active SVG/HTML. */
export function validateAvatarDataUrl(value: unknown): { dataUrl: string; contentType: string; size: number } | null {
  if (typeof value !== "string" || value.length > 2_800_000) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2]!.length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length < 16 || bytes.length > 2 * 1024 * 1024 || bytes.toString("base64") !== match[2]) return null;
  const type = match[1]!;
  const valid = type === "image/png"
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString("ascii") === "IHDR" && bytes.length >= 33 && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(16) <= 8192 && bytes.readUInt32BE(20) <= 8192
    : type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(bytes.subarray(12, 16).toString("ascii")) && bytes.readUInt32LE(4) === bytes.length - 8;
  return valid ? { dataUrl: value, contentType: type, size: bytes.length } : null;
}
