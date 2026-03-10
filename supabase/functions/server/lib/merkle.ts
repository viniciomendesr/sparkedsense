/**
 * Binary Merkle tree with inclusion proof support.
 *
 * - Leaf hash = SHA-256(readingHash) for domain separation
 * - Odd layer: last node is duplicated
 * - Empty tree root = SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
 * - Deterministic: inputs MUST be pre-sorted before calling buildTree
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MerkleTree {
  root: string;
  leafCount: number;
  leaves: string[];
  layers: string[][];
}

export interface MerkleProofStep {
  hash: string;
  position: "left" | "right";
}

export interface MerkleProof {
  leafHash: string;
  leafIndex: number;
  proof: MerkleProofStep[];
  root: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const EMPTY_ROOT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

/**
 * Build a binary Merkle tree from an array of reading hashes.
 *
 * Each element is first hashed (domain-separated leaf) so that the raw
 * reading hash never appears as an internal node, preventing second-preimage
 * attacks.
 *
 * @param readingHashes  Pre-sorted array of hex-encoded SHA-256 hashes
 */
export async function buildTree(readingHashes: string[]): Promise<MerkleTree> {
  if (readingHashes.length === 0) {
    return { root: EMPTY_ROOT, leafCount: 0, leaves: [], layers: [[EMPTY_ROOT]] };
  }

  // Domain-separated leaves
  const leaves: string[] = await Promise.all(
    readingHashes.map((h) => sha256Hex(h)),
  );

  const layers: string[][] = [leaves];

  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i]; // duplicate odd
      next.push(await sha256Hex(left + right));
    }
    layers.push(next);
    current = next;
  }

  return {
    root: current[0],
    leafCount: leaves.length,
    leaves,
    layers,
  };
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

/**
 * Generate an inclusion proof for the leaf at `leafIndex`.
 */
export async function generateProof(
  tree: MerkleTree,
  leafIndex: number,
): Promise<MerkleProof> {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new RangeError(
      `leafIndex ${leafIndex} out of range [0, ${tree.leafCount})`,
    );
  }

  const proof: MerkleProofStep[] = [];
  let idx = leafIndex;

  // Walk from leaf layer up to (but not including) the root layer
  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const currentLayer = tree.layers[layer];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;

    // If sibling doesn't exist, the node was duplicated (odd layer)
    const siblingHash =
      siblingIdx < currentLayer.length
        ? currentLayer[siblingIdx]
        : currentLayer[idx];

    proof.push({
      hash: siblingHash,
      position: isRight ? "left" : "right",
    });

    idx = Math.floor(idx / 2);
  }

  return {
    leafHash: tree.leaves[leafIndex],
    leafIndex,
    proof,
    root: tree.root,
  };
}

// ---------------------------------------------------------------------------
// Proof verification
// ---------------------------------------------------------------------------

/**
 * Verify an inclusion proof.
 *
 * @param leafHash      The domain-separated leaf hash (SHA-256 of the reading hash)
 * @param proof         Array of sibling steps from leaf to root
 * @param expectedRoot  The Merkle root to verify against
 */
export async function verifyProof(
  leafHash: string,
  proof: MerkleProofStep[],
  expectedRoot: string,
): Promise<boolean> {
  let current = leafHash;

  for (const step of proof) {
    if (step.position === "left") {
      current = await sha256Hex(step.hash + current);
    } else {
      current = await sha256Hex(current + step.hash);
    }
  }

  return current === expectedRoot;
}
