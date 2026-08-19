-- Estende o enum operational_profile com os dois perfis de piloto (asa fixa /
-- asa rotativa) — até aqui o enum só cobria perfis de controlador de tráfego
-- aéreo (TWR/APP/ACC/COpM) + 'general'. Piloto e controlador têm exames
-- diferentes (target_exam já é texto livre, sem mudança de schema
-- necessária ali) mas compartilham a mesma coluna operational_profile.
-- Postgres não permite remover valores de um enum, só adicionar — não precisa
-- recriar o tipo como na migration anterior (20260810000000), que removia
-- valores.
alter type public.operational_profile add value 'fixed_wing';
alter type public.operational_profile add value 'rotary_wing';

-- Foto de perfil (upload em /perfil, bucket de Storage "avatars" — ver
-- scripts/create-avatars-bucket.mjs e a migration de policies seguinte).
alter table public.users add column avatar_url text;
