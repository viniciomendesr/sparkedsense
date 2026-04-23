/**
 * ADR-007 partial: real Merkle root anchoring on Solana devnet via the Memo Program.
 *
 * We deliberately do NOT depend on @solana/web3.js — the bundle is too heavy
 * for Supabase Edge Runtime cold starts (observed WORKER_RESOURCE_LIMIT).
 * Instead we build a legacy Solana transaction by hand: compact-u16 lengths,
 * message header, account keys, instruction data, and an ed25519 signature.
 *
 * Only two external dependencies: `@noble/curves/ed25519` for signing and
 * `bs58` for address/signature encoding. Both are tiny (<20KB each).
 */

import { ed25519 } from "https://esm.sh/@noble/curves@1.4.0/ed25519";
import bs58 from "https://esm.sh/bs58@5.0.0";

const MEMO_PROGRAM_ID_B58 = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnchorResult {
  signature: string;
  explorerUrl: string;
  cluster: "devnet" | "mainnet-beta" | "testnet";
  memo: string;
}

export interface AnchorParams {
  datasetId: string;
  merkleRoot: string;
  readingsCount: number;
  startISO: string;
  endISO: string;
}

// ---------------------------------------------------------------------------
// Public helpers (cheap — no bytecode loaded here)
// ---------------------------------------------------------------------------

export const isAnchoringEnabled = (): boolean =>
  !!Deno.env.get("SOLANA_SERVER_SECRET_KEY_BASE58");

export const getServerPublicKey = (): string | null => {
  const secretKeyBase58 = Deno.env.get("SOLANA_SERVER_SECRET_KEY_BASE58");
  if (!secretKeyBase58) return null;
  try {
    const secret = bs58.decode(secretKeyBase58);
    if (secret.length !== 64) return null;
    // Last 32 bytes of a Solana secret key are the public key — no curve work needed.
    return bs58.encode(secret.slice(32));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Binary helpers for the Solana legacy tx format
// ---------------------------------------------------------------------------

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

// Solana's compact-u16: 1..3 bytes, little-endian base-128 with continuation bit.
const encodeCompactU16 = (n: number): Uint8Array => {
  if (n < 0 || n > 0xffff) throw new Error(`compact-u16 out of range: ${n}`);
  const bytes: number[] = [];
  let value = n;
  while (true) {
    let byte = value & 0x7f;
    value >>= 7;
    if (value === 0) {
      bytes.push(byte);
      return new Uint8Array(bytes);
    }
    byte |= 0x80;
    bytes.push(byte);
  }
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------

interface JsonRpcError { code: number; message: string }

const rpc = async <T>(rpcUrl: string, method: string, params: unknown[] = []): Promise<T> => {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json() as { result?: T; error?: JsonRpcError };
  if (data.error) throw new Error(`RPC ${method} error: ${data.error.message}`);
  if (data.result === undefined) throw new Error(`RPC ${method}: no result`);
  return data.result;
};

const getLatestBlockhash = async (rpcUrl: string): Promise<string> => {
  const r = await rpc<{ value: { blockhash: string } }>(rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  return r.value.blockhash;
};

const sendRawTransaction = async (rpcUrl: string, txBytes: Uint8Array): Promise<string> => {
  const b64 = bytesToBase64(txBytes);
  return await rpc<string>(rpcUrl, "sendTransaction", [b64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }]);
};

const confirmTransaction = async (rpcUrl: string, signature: string, timeoutMs = 20000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await rpc<{ value: Array<{ confirmationStatus?: string; err?: unknown } | null> }>(
      rpcUrl,
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: false }],
    );
    const status = r.value?.[0];
    if (status) {
      if (status.err) throw new Error(`Tx failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Transaction confirmation timed out");
};

// ---------------------------------------------------------------------------
// Message + transaction construction
// ---------------------------------------------------------------------------

/**
 * Build a legacy Solana transaction message carrying a single Memo Program call.
 * Header: 1 required signature (fee payer), 0 readonly-signed, 1 readonly-unsigned (Memo program).
 * Account keys: [feePayer (signer+writable), memoProgramId (readonly, unsigned)].
 * Single instruction: programIdIndex=1, 0 accounts, data=memo bytes.
 */
const buildMemoMessage = (
  feePayerPubkey: Uint8Array,
  memoBytes: Uint8Array,
  blockhashB58: string,
): Uint8Array => {
  if (feePayerPubkey.length !== 32) throw new Error("feePayer pubkey must be 32 bytes");
  const memoProgramId = bs58.decode(MEMO_PROGRAM_ID_B58);
  if (memoProgramId.length !== 32) throw new Error("memo program id decode failed");
  const blockhash = bs58.decode(blockhashB58);
  if (blockhash.length !== 32) throw new Error("blockhash decode failed");

  const header = new Uint8Array([1, 0, 1]);
  const accountKeys = concat(encodeCompactU16(2), feePayerPubkey, memoProgramId);

  const instruction = concat(
    new Uint8Array([1]),             // programIdIndex -> memoProgramId
    encodeCompactU16(0),             // 0 account indices referenced
    encodeCompactU16(memoBytes.length),
    memoBytes,
  );
  const instructions = concat(encodeCompactU16(1), instruction);

  return concat(header, accountKeys, blockhash, instructions);
};

const buildMemo = (p: AnchorParams): string =>
  `sparked-sense://dataset/${p.datasetId}` +
  `?root=${p.merkleRoot}` +
  `&n=${p.readingsCount}` +
  `&from=${p.startISO}` +
  `&to=${p.endISO}`;

const inferCluster = (rpcUrl: string): AnchorResult["cluster"] => {
  if (rpcUrl.includes("mainnet")) return "mainnet-beta";
  if (rpcUrl.includes("testnet")) return "testnet";
  return "devnet";
};

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export const anchorMerkleRoot = async (p: AnchorParams): Promise<AnchorResult> => {
  const secretKeyBase58 = Deno.env.get("SOLANA_SERVER_SECRET_KEY_BASE58");
  if (!secretKeyBase58) throw new Error("SOLANA_SERVER_SECRET_KEY_BASE58 not configured");
  const rpcUrl = Deno.env.get("SOLANA_RPC_URL") ?? DEFAULT_RPC_URL;
  const cluster = inferCluster(rpcUrl);

  const secret = bs58.decode(secretKeyBase58);
  if (secret.length !== 64) throw new Error(`Invalid secret key length: ${secret.length}`);
  const privSeed = secret.slice(0, 32);
  const pubkey = secret.slice(32);

  const memo = buildMemo(p);
  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length > 566) throw new Error(`Memo too long (${memoBytes.length} bytes, limit 566)`);

  const blockhash = await getLatestBlockhash(rpcUrl);
  const message = buildMemoMessage(pubkey, memoBytes, blockhash);
  const signature = ed25519.sign(message, privSeed);

  // Full tx: compact-u16 signatures count || signature || message
  const txBytes = concat(encodeCompactU16(1), signature, message);

  const sigBase58 = await sendRawTransaction(rpcUrl, txBytes);
  await confirmTransaction(rpcUrl, sigBase58);

  const explorerUrl = `https://explorer.solana.com/tx/${sigBase58}?cluster=${cluster}`;
  console.log(`⚓ Anchored dataset ${p.datasetId} · root=${p.merkleRoot.substring(0, 12)}... · tx=${sigBase58.substring(0, 16)}...`);
  return { signature: sigBase58, explorerUrl, cluster, memo };
};
