import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

// Upload da foto de perfil. Route handler comum (não Server Action) pelo
// mesmo motivo já documentado em src/app/api/phase2/submit-response/route.ts
// — arquivo binário como multipart/form-data não passa pelo limite do
// protocolo Flight que as Server Actions usam pra decodificar argumentos.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("avatar");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Imagem muito grande (máximo 5MB)." }, { status: 400 });
  }
  const ext = ALLOWED_MIME_TO_EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Formato não suportado — use PNG, JPEG ou WebP." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Caminho fixo por usuário (upsert) — sempre sobrescreve a mesma foto, sem
  // acumular versões antigas no bucket.
  const path = `${auth.user.id}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadError) {
    return NextResponse.json(
      { error: `Falha ao enviar a imagem: ${uploadError.message}` },
      { status: 500 },
    );
  }

  const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-busting: o path é sempre o mesmo (upsert), então sem isso o
  // navegador continuaria mostrando a foto antiga em cache.
  const avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase
    .from("users")
    .update({ avatar_url: avatarUrl })
    .eq("id", auth.user.id);
  if (updateError) {
    return NextResponse.json(
      { error: "Não foi possível salvar a foto de perfil." },
      { status: 500 },
    );
  }

  return NextResponse.json({ avatarUrl });
}
