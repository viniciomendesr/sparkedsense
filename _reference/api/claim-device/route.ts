import { NextRequest, NextResponse } from "next/server";
import { addOrUpdateDevice, getDeviceByClaimToken } from "@/lib/deviceRegistry";
import { transferNft } from "@/lib/solanaService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { claimToken, ownerWalletAddress } = body;

    if (!claimToken || !ownerWalletAddress) {
      return NextResponse.json({ error: "Missing claimToken or ownerWalletAddress" }, { status: 400 });
    }

    const device = await getDeviceByClaimToken(claimToken);
    if (!device) {
      return NextResponse.json({ error: "Invalid or expired claim token" }, { status: 404 });
    }

    if (device.ownerAddress) {
      return NextResponse.json({ error: "Device has already been claimed" }, { status: 409 });
    }

    if (!device.nftAddress) {
      return NextResponse.json({ error: "Cannot claim device: NFT address is missing." }, { status: 500 });
    }

    console.log(`Transferring NFT ${device.nftAddress} to ${ownerWalletAddress}...`);
    const txSignature = await transferNft(device.nftAddress, ownerWalletAddress);
    console.log(`Transfer successful! Signature: ${txSignature}`);

    await addOrUpdateDevice(device.publicKey, {
      macAddress: device.macAddress,     
      nftAddress: device.nftAddress,   
      ownerAddress: ownerWalletAddress,  
      claimToken: null,                  
    });

    return NextResponse.json({ success: true, transactionSignature: txSignature });

  } catch (error: any) {
    console.error("Claim device error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}