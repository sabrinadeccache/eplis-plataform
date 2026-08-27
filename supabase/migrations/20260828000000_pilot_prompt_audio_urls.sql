-- Áudios pré-gerados da Parte 2 (falas do ATC) e Parte 3 (gravação
-- piloto/controlador) do SDEA — TTS + efeito de rádio, gerados por
-- scripts/generate-pilot-prompt-audio.mjs e servidos do bucket público
-- `pilot-prompt-audio`. Antes desta migration todo áudio era TTS em runtime,
-- voz única e sem efeito (doc "Modelo SDEA com anotações", pág. 7).
--
-- Colunas nullable: quando a URL é null o runner cai no TTS em runtime do
-- texto (`atc_audio_text` / `atc_followup_audio_text` / `prompt_text`), então
-- o conteúdo continua funcionando enquanto o áudio não foi gerado.
alter table public.pilot_prompts
  add column if not exists atc_audio_url text,
  add column if not exists atc_followup_audio_url text,
  add column if not exists dialogue_audio_url text;
