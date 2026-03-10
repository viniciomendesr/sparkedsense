import { NextRequest, NextResponse } from "next/server";
import { getDeviceByPubKey } from "@/lib/deviceRegistry"; 

/**
 * Esta API serve como um mecanismo de recuperação para obter um claimToken 
 * de um dispositivo que já foi registrado mas ainda não foi reivindicado.
 * * Requer o `publicKey` do dispositivo para provar o conhecimento do dispositivo.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { publicKey } = body;

    if (!publicKey) {
      return NextResponse.json({ error: "Missing device publicKey" }, { status: 400 });
    }

    const device = await getDeviceByPubKey(publicKey);
    if (!device) {
      return NextResponse.json({ error: "Device not found for the given publicKey" }, { status: 404 });
    }

    if (device.ownerAddress) {
      return NextResponse.json({ error: "Device has already been claimed" }, { status: 409 });
    }

    if (!device.claimToken) {
      return NextResponse.json({ error: "No claim token available for this device. Please try re-registering." }, { status: 404 });
    }

    console.log(`Re-issuing claim token for device: ${publicKey.substring(0, 20)}...`);
    return NextResponse.json({
      nftAddress: device.nftAddress,
      claimToken: device.claimToken
    });

  } catch (error: any) {
    console.error("Get claim token error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}