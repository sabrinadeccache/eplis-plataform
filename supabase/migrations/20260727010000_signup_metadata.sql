-- Estende o trigger de cadastro para ler role/target_exam/operational_profile do
-- raw_user_meta_data enviado no signUp (Fase 3 — formulário de cadastro), em vez de
-- deixar tudo no default e exigir uma edição de perfil separada depois.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email, role, target_exam, operational_profile)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'role')::public.role, 'pilot'),
    coalesce(new.raw_user_meta_data ->> 'target_exam', 'EPLIS'),
    (new.raw_user_meta_data ->> 'operational_profile')::public.operational_profile
  );
  return new;
end;
$$;
