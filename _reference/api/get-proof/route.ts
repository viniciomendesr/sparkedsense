import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import { list } from '@vercel/blob';
import { Buffer } from "buffer";

/**
 * Busca a Prova Merkle para um hash de dados específico.
 * Recebe via query: /api/get-proof?hash=...
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const hash = searchParams.get('hash');

    if (!hash) {
        return NextResponse.json({ error: "O hash do dado é obrigatório" }, { status: 400 });
    }

    try {
        // --- 1. Tenta buscar no Cache Rápido (Redis) ---
        const proofKey = `proof:${hash}`;
        let proofData = await redis.get(proofKey);

        if (proofData) {
            console.log(`[Cache HIT] Prova encontrada no Redis para: ${hash}`);
            return NextResponse.json(JSON.parse(proofData), { status: 200 });
        }

        // --- 2. Se falhar, busca no Armazenamento Permanente (Vercel Blob) ---
        console.log(`[Cache MISS] Prova não encontrada no Redis. Buscando no Vercel Blob...`);
        const blobPathname = `proofs/${hash}.json`;

        try {
            // A. Usa 'list' para encontrar o arquivo pelo seu caminho completo
            const { blobs } = await list({
                prefix: blobPathname,
                limit: 1 // Queremos apenas o arquivo exato
            });

            // B. Verifica se o arquivo foi encontrado
            if (blobs.length === 0) {
                console.error(`Prova não encontrada nem no Blob: ${hash}`);
                return NextResponse.json({ error: "Prova não encontrada. O dado pode não ter sido processado ou é inválido." }, { status: 404 });
            }

            // C. Pega o URL público do blob
            const blobFile = blobs[0];
            const publicUrl = blobFile.url;

            // D. Usa 'fetch()' para baixar o conteúdo do arquivo
            const blobResponse = await fetch(publicUrl);
            
            if (!blobResponse.ok) {
                throw new Error(`Falha ao buscar o arquivo do Blob no URL: ${publicUrl} (Status: ${blobResponse.status})`);
            }

            // E. Pega o conteúdo do Blob como texto
            const proofDataFromBlob = await blobResponse.text();

            // F. (Opcional, mas recomendado) Salva de volta no Redis
            await redis.set(proofKey, proofDataFromBlob, "EX", 60 * 60 * 24 * 30);

            // G. Retorna os dados da prova
            return NextResponse.json(JSON.parse(proofDataFromBlob), { status: 200 });

        } catch (blobError: any) {
            console.error(`Erro ao buscar prova no Blob para ${hash}:`, blobError);
            return NextResponse.json({ error: "Erro interno do Blob", details: blobError.message }, { status: 500 });
        }

    } catch (error: any) {
        console.error(`Erro ao buscar prova para ${hash}:`, error);
        return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
    }
}