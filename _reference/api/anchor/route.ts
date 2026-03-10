import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis"; // Seu cliente Redis
import { 
    Connection, 
    clusterApiUrl, 
    Keypair, 
    Transaction, 
    TransactionInstruction, 
    PublicKey, 
    sendAndConfirmTransaction,
    SystemProgram 
} from "@solana/web3.js";
import { MerkleTree } from "merkletreejs"; // Para a árvore
import { sha256 } from "js-sha256"; // Para o hash
import bs58 from "bs58"; // Para decodificar a chave privada

// Chaves de segurança das suas Variáveis de Ambiente
const CRON_SECRET = process.env.CRON_SECRET;
const SERVER_WALLET_SECRET = process.env.SERVER_SECRET_KEY_BASE58;

// O endereço do Programa Memo, que é uma constante na Solana
const MEMO_PROGRAM_ID = new PublicKey("Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo");

/**
 * Endpoint protegido (Cron Job) para ancorar a Merkle Root na blockchain
 * usando o Memo Program (simples, sem Smart Contract).
 */
export async function POST(req: NextRequest) {
    // --- 1. Autorização ---
    const vercelCronSecret = req.headers.get('x-vercel-cron-secret');
    
    if (!CRON_SECRET || vercelCronSecret !== CRON_SECRET) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    // --- 2. Preparação das Chaves do Redis ---
    const batchKey = "sensor_data_batch";
    const processingKey = `processing_batch_${Date.now()}`;

    let payloads: string[] = [];

    try {
        // --- 3. Coleta dos Dados do Redis ---
        await redis.rename(batchKey, processingKey);
        payloads = await redis.lrange(processingKey, 0, -1);

        if (payloads.length === 0) {
            console.log("Nenhum dado no lote para processar.");
            await redis.del(processingKey); 
            return NextResponse.json({ success: true, message: "Nenhum dado para ancorar." });
        }

        console.log(`Processando ${payloads.length} registros...`);

        // --- 4. Cálculo da Merkle Tree ---
        const leaves = payloads.map(payload => sha256(payload));
        const tree = new MerkleTree(leaves, sha256);
        const rootBuffer = tree.getRoot();
        const rootHex = rootBuffer.toString('hex'); // A raiz como texto

        console.log(`Merkle Root calculada: ${rootHex}`);

        // --- 5. Conexão com a Solana (Testnet) ---
        if (!SERVER_WALLET_SECRET) {
            throw new Error("SERVER_WALLET_SECRET_KEY não configurada!");
        }

        const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
        const payer = Keypair.fromSecretKey(bs58.decode(SERVER_WALLET_SECRET));

        // --- 6. Criar a Transação com Memo ---
        const transaction = new Transaction();

        // Instrução 1: Enviar 0.000001 SOL para nós mesmos (só para ter uma transação)
        // (Tecnicamente, o Memo pode ser a única instrução, mas isso é mais explícito)
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: payer.publicKey,
                lamports: 1000, // 0.000001 SOL (só para constar)
            })
        );
        
        // Instrução 2: Anexar a Merkle Root como um "memo"
        transaction.add(
            new TransactionInstruction({
                keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
                programId: MEMO_PROGRAM_ID,
                data: Buffer.from(rootHex, "utf8"), // Anexa a raiz como texto
            })
        );

        // --- 7. Enviar a Transação ---
        const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);

        console.log(`✅ Sucesso! Transação enviada: ${signature}`);
        console.log(`Raiz ${rootHex} ancorada na Testnet via Memo.`);

        // --- 8. Salvar as Provas no Redis (Quente) e no Vercel Blob (Frio) ---
        const savePromises = leaves.map(async (leafBuffer, index) => {
        const leafHash = leafBuffer; 
        const originalPayload = payloads[index];

        // O que vamos salvar
        const proofData = JSON.stringify({
                root: rootHex,
                proof: tree.getProof(leafBuffer).map(p => ({
                    position: p.position,
                    data: p.data.toString('hex')
                })),
                signature: signature,
                originalData: originalPayload
            });

        // O "nome do arquivo" no Blob (e a chave no Redis)
        const proofKey = `proof:${leafHash}`;
        const blobPathname = `proofs/${leafHash}.json`; // ex: proofs/70fc07...505.json

        // Retorna um array de promessas: uma para o Redis, uma para o Blob
            return [
                // 1. Salva no Redis (expira em 30 dias)
                redis.set(proofKey, proofData, "EX", 60 * 60 * 24 * 30),

                // 2. Salva no Vercel Blob (para sempre)
                put(blobPathname, proofData, {
                    access: 'public', // Torna o arquivo legível publicamente
                    contentType: 'application/json'
                })
            ];
        });

        // Espera todas as promessas (achatadas) terminarem
        await Promise.all(savePromises.flat()); 
        console.log(`Salvas ${payloads.length} provas no Redis (30 dias) e no Vercel Blob (Permanente).`);

        // --- 9. Limpeza ---
        await redis.del(processingKey);

        return NextResponse.json({
            success: true,
            message: `Lote de ${payloads.length} itens ancorado com sucesso.`,
            root: rootHex,
            signature: signature
        });

    } catch (error: any) {
        console.error("❌ Falha ao processar o lote de ancoragem:", error);

        // Se falhar, devolve os dados para a fila principal
        try {
            await redis.rename(processingKey, batchKey);
            console.log("Lote de processamento devolvido para a fila principal.");
        } catch (renameError) {
            console.error("!! FALHA CRÍTICA: Não foi possível devolver o lote:", renameError);
        }

        return NextResponse.json({ error: error.message || "Erro interno do servidor" }, { status: 500 });
    }
}