-- Allow the optional UMC 05 Attendance History file: a Drive batch has the four
-- core reports, plus attendance history when it was exported with them.
-- Rewrites only the file-count check in the live definition; everything else is unchanged.
do $$
declare
 old_check constant text := 'jsonb_array_length(p_payload#>''{import_summary,driveSync,files}'') is distinct from 4';
 new_check constant text := 'coalesce(jsonb_array_length(p_payload#>''{import_summary,driveSync,files}''),0) not in (4,5)';
 d text := pg_get_functiondef('public.import_clubworx_drive_batch(jsonb,jsonb)'::regprocedure);
begin
 if (length(d) - length(replace(d, old_check, ''))) / length(old_check) <> 1 then
  raise exception 'import_clubworx_drive_batch has an unexpected definition; not changed';
 end if;
 execute replace(d, old_check, new_check);
end $$;
