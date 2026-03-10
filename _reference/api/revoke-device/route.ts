import { NextRequest, NextResponse } from "next/server";
import { getDeviceByNft, revokeDevice } from "@/lib/deviceRegistry";

export async function POST(req: NextRequest) {
  try {
    const { nftAddress, signature } = await req.json();

    if (!nftAddress || !signature) {
      return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
    }

    const device = await getDeviceByNft(nftAddress);
    if (!device)
      return NextResponse.json({ error: "Dispositivo não encontrado" }, { status: 404 });

    if (device.revoked)
      return NextResponse.json({ error: "Dispositivo já revogado" }, { status: 400 });

    // Import dinâmico para evitar erro no build da Vercel
    const elliptic = await import("elliptic");
    const { sha256 } = await import("js-sha256");
    const BN = (await import("bn.js")).default;

    const ec = new elliptic.ec("secp256k1");

    const message = `revoke:${nftAddress}`;
    const pub = ec.keyFromPublic(device.publicKey, "hex");
    const hashHex = sha256(message);

    const sig = {
      r: new BN(signature.r, 16),
      s: new BN(signature.s, 16),
    };

    const verified = pub.verify(hashHex, sig);
    if (!verified) {
      return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
    }

    await revokeDevice(nftAddress);
    return NextResponse.json({ status: "revoked", nftAddress });
  } catch (err: any) {
    console.error("Erro revogação:", err);
    return NextResponse.json(
      { error: err.message || "Erro interno no servidor" },
      { status: 500 }
    );
  }
}
