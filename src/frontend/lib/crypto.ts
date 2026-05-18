/**
 * Crypto utilities for frontend.
 * Note: Actual encryption is done on the server.
 * This module provides file hashing for integrity checks.
 */
import { createHash } from "crypto-browser-format";

export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = createHash("sha256");
  hash.update(new Uint8Array(buffer));
  return hash.digest("hex");
}

export function generateChecksum(content: string): string {
  return createHash("md5").update(content).digest("hex");
}