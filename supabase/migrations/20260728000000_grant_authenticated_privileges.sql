-- RLS policies restrict *rows*, but Postgres also requires base table-level
-- GRANTs before a role can touch a table at all — RLS is evaluated only after
-- that check passes. Supabase's dashboard/CLI migration flow grants this
-- automatically for new tables; since our migrations are applied via a direct
-- `pg` connection (no Supabase CLI on this machine yet), that step was missing,
-- and every authenticated query against these tables failed with
-- "permission denied for table X" regardless of the RLS policies being correct.

grant select, update on public.users to authenticated;
grant select, insert, update on public.simulation_attempts to authenticated;
grant select on public.phase1_audios to authenticated;
grant select on public.phase1_questions to authenticated;
grant select, insert on public.phase1_answers to authenticated;
grant select on public.phase2_prompts to authenticated;
grant select, insert, update on public.phase2_responses to authenticated;
grant select on public.simulation_feedbacks to authenticated;
