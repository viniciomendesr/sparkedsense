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

export interface MerkleTreeFull {
  root: string;
  leaves: string[]; // domain-separated leaf hashes
  layers: string[][];
}

/**
 * Build the full Merkle tree client-side so we can generate inclusion proofs
 * for individual readings. Same algorithm as the backend's `buildTree`.
 */
export async function buildMerkleTreeFull(
  readingHashes: string[],
): Promise<MerkleTreeFull> {
  if (readingHashes.length === 0) {
    return { root: EMPTY_ROOT, leaves: [], layers: [[EMPTY_ROOT]] };
  }

  const leaves = await Promise.all(readingHashes.map((h) => sha256Hex(h)));
  const layers: string[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      next.push(await sha256Hex(left + right));
    }
    layers.push(next);
    current = next;
  }
  return { root: current[0], leaves, layers };
}

/**
 * Generate an inclusion proof for the leaf at `leafIndex`.
 * Returns the sibling hashes walked up from the leaf to the root.
 */
export function generateInclusionProof(
  tree: MerkleTreeFull,
  leafIndex: number,
): { leafHash: string; proof: MerkleProofStep[] } {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new RangeError(`leafIndex ${leafIndex} out of range`);
  }
  const proof: MerkleProofStep[] = [];
  let idx = leafIndex;
  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const currentLayer = tree.layers[layer];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const siblingHash =
      siblingIdx < currentLayer.length
        ? currentLayer[siblingIdx]
        : currentLayer[idx]; // duplicate-last on odd
    proof.push({ hash: siblingHash, position: isRight ? 'left' : 'right' });
    idx = Math.floor(idx / 2);
  }
  return { leafHash: tree.leaves[leafIndex], proof };
}

/**
 * Walk the proof step-by-step, returning each intermediate hash. Used by
 * the UI to render the proof as a visible chain, not a single boolean.
 */
export async function traceInclusionProof(
  leafHash: string,
  proof: MerkleProofStep[],
): Promise<
  Array<{
    step: number;
    left: string;
    right: string;
    result: string;
    siblingFromSide: 'left' | 'right';
  }>
> {
  const trace: Array<{
    step: number;
    left: string;
    right: string;
    result: string;
    siblingFromSide: 'left' | 'right';
  }> = [];
  let current = leafHash;
  for (let i = 0; i < proof.length; i++) {
    const step = proof[i];
    const left = step.position === 'left' ? step.hash : current;
    const right = step.position === 'left' ? current : step.hash;
    const result = await sha256Hex(left + right);
    trace.push({ step: i + 1, left, right, result, siblingFromSide: step.position });
    current = result;
  }
  return trace;
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
