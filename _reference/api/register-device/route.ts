import { NextRequest, NextResponse } from "next/server";
import { addOrUpdateDevice, getDeviceByPubKey, DeviceEntry } from "@/lib/deviceRegistry";
import crypto from "crypto";
import { createAndMintNft } from "@/lib/solanaService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { macAddress, publicKey, challenge, signature } = body;

    if (!challenge && !signature) {
      if (!macAddress || !publicKey) {
        return NextResponse.json({ error: "Missing macAddress or publicKey" }, { status: 400 });
      }
      const challengeValue = crypto.randomBytes(32).toString("hex");
      await addOrUpdateDevice(publicKey, { macAddress, challenge: challengeValue });
      console.log(`Challenge issued for publicKey: ${publicKey.substring(0, 20)}...`);
      return NextResponse.json({ challenge: challengeValue });
    }

    if (!publicKey || !challenge || !signature) {
      return NextResponse.json({ error: "Missing fields for signature verification" }, { status: 400 });
    }

    const device = await getDeviceByPubKey(publicKey);
    if (!device || device.challenge !== challenge) {
      return NextResponse.json({ error: "Invalid challenge or device not found" }, { status: 401 });
    }

    const elliptic = await import("elliptic");
    const { sha256 } = await import("js-sha256");
    const BN = (await import("bn.js")).default;
    const ec = new elliptic.ec("secp256k1");
    const msgHash = sha256(challenge);
    const key = ec.keyFromPublic(publicKey, "hex");
    const sig = { r: new BN(signature.r, 16), s: new BN(signature.s, 16) };
    const isSignatureValid = key.verify(msgHash, sig);
    if (!isSignatureValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    
    console.log(`Signature verified for publicKey: ${publicKey.substring(0, 20)}...`);

    const finalDeviceData: Partial<DeviceEntry> = {
      challenge: undefined,
      macAddress: device.macAddress,
    };

    let claimToken: string | null = null;

    if (!device.nftAddress) {
      console.log("Creating and minting a new NFT for the device...");
      const result = await createAndMintNft();
      finalDeviceData.nftAddress = result.nftAddress;
      finalDeviceData.txSignature = result.txSignature;

      claimToken = crypto.randomBytes(16).toString("hex");
      finalDeviceData.claimToken = claimToken;

      console.log(`NFT created: ${result.nftAddress} with claim token.`);
    }

    const updatedDevice = await addOrUpdateDevice(publicKey, finalDeviceData);

    return NextResponse.json({
      nftAddress: updatedDevice.nftAddress,
      txSignature: updatedDevice.txSignature,
      claimToken: claimToken 
    });

  } catch (err: any) {
    console.error("Register device API error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}