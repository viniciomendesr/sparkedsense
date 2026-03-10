
import { NextRequest, NextResponse } from "next/server";
import { getDeviceByNftAndOwner } from "@/lib/deviceRegistry"; 
import { ec as EC } from "elliptic";
import { sha256 } from "js-sha256";
import BN from "bn.js";
import stringify from "json-stable-stringify";

const ec = new EC("secp256k1");

/**
 * Assina um payload usando a chave privada (exatamente como o ESP faz).
 */
function signPayload(payload: any, privateKeyHex: string) {
  const key = ec.keyFromPrivate(privateKeyHex, "hex");
  
  // 1. Serialização canônica
  const canonicalPayloadString = stringify(payload);

  if (typeof canonicalPayloadString !== 'string') {
    throw new Error("Falha ao serializar o payload para assinatura.");
  }

  // 2. Hash SHA-256
  const msgHash = sha256(canonicalPayloadString);

  // 3. Assinatura
  const sig = key.sign(msgHash, { canonical: true });

  // 4. Formata como o backend espera
  return {
    r: sig.r.toString("hex"),
    s: sig.s.toString("hex"),
  };
}


/**
 * Ponto de entrada para um usuário (dono) enviar dados "como se fosse"
 * seu dispositivo mock.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      ownerWalletAddress, // "Quem" está enviando
      nftAddress,         // "Qual" dispositivo está sendo usado
      data                // "O que" está sendo enviado (ex: { "temperature": 25.5 })
    } = body;

    if (!ownerWalletAddress || !nftAddress || !data) {
      return NextResponse.json({ error: "ownerWalletAddress, nftAddress, e data são obrigatórios" }, { status: 400 });
    }

    // 1. Validar posse e buscar dispositivo
    // Você precisa criar esta função no seu deviceRegistry:
    // ex: SELECT * FROM devices WHERE nft_address = ? AND owner_address = ? AND is_mock = true
    const device = await getDeviceByNftAndOwner(nftAddress, ownerWalletAddress);

    if (!device) {
      return NextResponse.json({ error: "Dispositivo mock não encontrado ou você não é o dono." }, { status: 404 });
    }

    const privateKey = (device as any).mock_private_key;
    if (!privateKey) {
      return NextResponse.json({ error: "Chave privada do dispositivo mock não encontrada. Contate o suporte." }, { status: 500 });
    }

    // 2. Preparar o payload canônico
    const payload = {
      ...data,
      timestamp: Math.floor(Date.now() / 1000)
    };

    // 3. Assinar o payload no backend
    const signature = signPayload(payload, privateKey);

    // 4. Construir o corpo da requisição para a API /api/sensor-data
    const apiBody = {
      nftAddress: device.nftAddress,
      payload,
      signature
    };

    // 5. Chamar a API /api/sensor-data (o "portão canônico")
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const sensorApiUrl = `${appUrl}/api/sensor-data`;

    const response = await fetch(sensorApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiBody)
    });

    const responseBody = await response.json();

    // 6. Repassar a resposta (sucesso ou erro)
    if (!response.ok) {
        // Se a API de dados falhar (ex: rate limit 429), repassa o erro
        return NextResponse.json(responseBody, { status: response.status });
    }

    // Sucesso!
    return NextResponse.json({
      success: true,
      message: "Dado submetido ao lote com sucesso. Aguarde o próximo ciclo de ancoragem.",
      submittedData: apiBody
    });

  } catch (error: any) {
    console.error("Falha ao submeter dado mock:", error);
    return NextResponse.json({ error: error.message || "Erro interno do servidor" }, { status: 500 });
  }
}
