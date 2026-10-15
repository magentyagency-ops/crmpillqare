-- Planificateur du CRM : appelle /api/cron/tick chaque minute (relances, rappels de RDV,
-- synchronisation Gmail / Google Agenda, planning quotidien).
-- À exécuter une fois dans Supabase → SQL Editor, après avoir remplacé les deux valeurs ci-dessous.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('pillqare-crm-tick') where exists (select 1 from cron.job where jobname = 'pillqare-crm-tick');

select cron.schedule(
  'pillqare-crm-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://VOTRE-DOMAINE/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer VOTRE_CRON_SECRET', 'Content-Type', 'application/json'),
    timeout_milliseconds := 290000
  );
  $$
);
