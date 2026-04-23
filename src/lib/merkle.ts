/**
 * Client-side Merkle tree verification using Web Crypto API.
 *
 * This module mirrors the backend merkle.ts logic so that verification
 * can happen entirely in the browser — no server round-trip needed.
 */

export interface MerkleProofStep {
  hash: string;
  position: "left" | "right";
}

const EMPTY_ROOT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async function sha256Hex(data: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify an inclusion proof for a single reading.
 *
 * @param readingHash   The original reading hash (before domain-separation)
 * @param proof         Sibling steps from leaf to root
 * @param expectedRoot  The Merkle root to verify against
 */
export async function verifyMerkleProof(
  readingHash: string,
  proof: MerkleProofStep[],
  expectedRoot: string,
): Promise<boolean> {
  // Domain-separated leaf (same as backend)
  let current = await sha256Hex(readingHash);

  for (const step of proof) {
    if (step.position === "left") {
      current = await sha256Hex(step.hash + current);
    } else {
      current = await sha256Hex(current + step.hash);
    }
  }

  return current === expectedRoot;
}

/**
 * Reconstruct a Merkle root from an array of reading hashes.
 *
 * @param readingHashes  Pre-sorted array of hex-encoded SHA-256 hashes
 */
export async function computeMerkleRoot(readingHashes: string[]): Promise<string> {
  if (readingHashes.length === 0) return EMPTY_ROOT;

  // Domain-separated leaves
  let current = await Promise.all(readingHashes.map((h) => sha256Hex(h)));

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      next.push(await sha256Hex(left + right));
    }
    current = next;
  }

  return current[0];
}

/**
 * Reconstruct a Merkle root from an array of reading hashes and compare
 * it against the expected root.
 */
export async function verifyMerkleRoot(
  readingHashes: string[],
  expectedRoot: string,
): Promise<boolean> {
  const root = await computeMerkleRoot(readingHashes);
  return root === expectedRoot;
}
