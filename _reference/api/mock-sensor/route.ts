

import { NextRequest, NextResponse } from "next/server";
// Importe suas funções de registro e Solana
import { addOrUpdateDevice, DeviceEntry } from "@/lib/deviceRegistry";
import { createAndMintNft, transferNft } from "@/lib/solanaService";
import { ec as EC } from "elliptic"; // Para gerar chaves

const ec = new EC("secp256k1");

/**
 * Cria um novo dispositivo "mock" e o associa diretamente
 * ao dono da carteira (usuário) que o solicitou.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      ownerWalletAddress, // Endereço da carteira do usuário logado
      sensorType // 'temperature', 'humidity' ou 'pH'
    } = body;

    if (!ownerWalletAddress || !sensorType) {
      return NextResponse.json({ error: "ownerWalletAddress e sensorType são obrigatórios" }, { status: 400 });
    }

    // --- 1. Gerar Identidade do Dispositivo (no Backend) ---
    console.log("Gerando novo par de chaves mock...");
    const keyPair = ec.genKeyPair();
    const privateKeyHex = keyPair.getPrivate("hex");
    // Formato '04' + X + Y (como no seu ESP)
    const publicKeyHex = keyPair.getPublic("hex"); 

    // --- 2. Simular Registro e Reivindicação (Tudo de uma vez) ---
    
    // 2a. Criar e Mintar o NFT (como o register-device faria)
    console.log("Mintando NFT para o dispositivo mock...");
    const { nftAddress } = await createAndMintNft();

    // 2b. Transferir o NFT (como o claim-device faria)
    console.log(`Transferindo NFT ${nftAddress} para ${ownerWalletAddress}...`);
    await transferNft(nftAddress, ownerWalletAddress);

    // --- 3. Salvar o Dispositivo Mock no Banco de Dados ---
    console.log("Salvando dispositivo mock no registro...");
    const mockMacAddress = `MOCK-${publicKeyHex.substring(2, 14)}`;

    // Presumindo que sua função addOrUpdateDevice pode lidar com novos campos
    // e que sua tabela 'devices' tem as colunas is_mock, etc.
    const finalDeviceData: Partial<DeviceEntry> & { [key: string]: any } = {
        macAddress: mockMacAddress,
        nftAddress: nftAddress,
        ownerAddress: ownerWalletAddress, // Já reivindicado
        is_mock: true,
        mock_sensor_type: sensorType,
        mock_private_key: privateKeyHex, // !! Lembre-se de encriptar isso !!
        claimToken: null, 
        challenge: undefined
    };

    const newMockDevice = await addOrUpdateDevice(publicKeyHex, finalDeviceData);

    return NextResponse.json({
      success: true,
      message: "Dispositivo mock criado e associado com sucesso.",
      device: {
        publicKey: newMockDevice.publicKey,
        nftAddress: newMockDevice.nftAddress,
        sensorType: (newMockDevice as any).mock_sensor_type
      }
    }, { status: 201 });

  } catch (error: any) {
    console.error("Falha ao criar dispositivo mock:", error);
    return NextResponse.json({ error: error.message || "Erro interno do servidor" }, { status: 500 });
  }
}
