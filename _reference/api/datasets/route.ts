// Em: app/api/datasets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from '@supabase/supabase-js';
import { put } from '@vercel/blob';

// (Importe seu cliente Supabase ou configure-o aqui)
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

/**
 * Cria um novo "pacote" de dataset.
 * Recebe: { nftAddress, startDate, endDate, requestedBy }
 */
export async function POST(req: NextRequest) {
  try {
    const { 
      nftAddress, 
      startDate, // ex: "2023-10-10T00:00:00Z"
      endDate,   // ex: "2023-10-20T23:59:59Z"
      requestedBy // ex: o endereço da carteira do usuário logado
    } = await req.json();

    if (!nftAddress || !startDate || !endDate || !requestedBy) {
      return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
    }

    // 1. Cria um registro do dataset no Supabase (com status 'processing')
    const { data: datasetEntry, error: createError } = await supabase
      .from('datasets')
      .insert({
        requested_by: requestedBy,
        nft_address: nftAddress,
        start_date: startDate,
        end_date: endDate,
        status: 'processing'
      })
      .select()
      .single(); // .single() retorna o objeto criado

    if (createError) throw createError;
    
    const datasetId = datasetEntry.id;

    // 2. Consulta os dados na tabela 'sensor_readings'
    const { data: readings, error: queryError } = await supabase
      .from('sensor_readings')
      .select('timestamp, data')
      .eq('nft_address', nftAddress)
      .gte('timestamp', startDate)
      .lte('timestamp', endDate)
      .order('timestamp', { ascending: true });
    
    if (queryError) throw queryError;

    // 3. Se não houver dados, atualiza o status para 'empty'
    if (!readings || readings.length === 0) {
      await supabase
        .from('datasets')
        .update({ status: 'empty', record_count: 0 })
        .eq('id', datasetId);
      return NextResponse.json({ message: "Nenhum dado encontrado para este período", datasetId: datasetId, status: 'empty' });
    }

    // 4. Se houver dados, salva no Vercel Blob
    const datasetContent = JSON.stringify(readings);
    const blobPathname = `datasets/dataset_${datasetId}.json`;

    const blob = await put(blobPathname, datasetContent, {
      access: 'public',
      contentType: 'application/json'
    });

    // 5. Atualiza o registro do dataset com o status 'completed' e o URL do blob
    const { data: finalDataset, error: updateError } = await supabase
      .from('datasets')
      .update({
        status: 'completed',
        record_count: readings.length,
        file_url: blob.url
      })
      .eq('id', datasetId)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    return NextResponse.json(finalDataset, { status: 201 }); // 201 Created

  } catch (error: any) {
    console.error("Falha ao criar o dataset:", error);
    // Tenta atualizar o dataset com o erro (melhor esforço)
    // (Você pode querer passar o 'datasetId' de outra forma se a primeira query falhar)
    return NextResponse.json({ error: error.message || "Erro interno do servidor" }, { status: 500 });
  }
}