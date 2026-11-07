-- =============================================================================
-- UTM MeteoNet · Base de datos de visitas (Supabase)
-- -----------------------------------------------------------------------------
-- Ejecuta este script en Supabase: SQL Editor -> New query -> Run.
-- Se puede ejecutar varias veces sin borrar datos: solo crea lo que falta y
-- actualiza las funciones.
--
-- Privacidad:
-- - No se almacena la dirección IP del usuario: se calcula su huella SHA-256
--   con una sal secreta generada aleatoriamente.
-- - Una misma IP cuenta como visita nueva únicamente tras 6 horas de inactividad.
-- - Las tablas tienen RLS habilitado: las claves públicas solo pueden invocar
--   las funciones registrar_visita() y resumen_visitas().
-- =============================================================================

begin;

set local search_path = public, extensions;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.meteonet_visitas (
  id bigint generated always as identity primary key,
  huella text not null,
  pais_codigo text,
  ciudad text,
  creado timestamptz not null default now(),
  ultima timestamptz not null default now()
);

create index if not exists meteonet_visitas_huella_idx on public.meteonet_visitas (huella, ultima desc);
create index if not exists meteonet_visitas_creado_idx on public.meteonet_visitas (creado desc);
create index if not exists meteonet_visitas_ultima_idx on public.meteonet_visitas (ultima desc);
alter table public.meteonet_visitas enable row level security;

create table if not exists public.meteonet_visitas_config (
  id int primary key default 1 check (id = 1),
  sal text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
insert into public.meteonet_visitas_config (id) values (1) on conflict (id) do nothing;
alter table public.meteonet_visitas_config enable row level security;

-- Resumen de visitas para MeteoNet
create or replace function public.resumen_visitas()
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select json_build_object(
    'total', (select count(*) from meteonet_visitas),
    'hoy', (select count(*) from meteonet_visitas where creado >= now() - interval '24 hours'),
    'paises', (select count(distinct pais_codigo) from meteonet_visitas where pais_codigo is not null),
    'top', coalesce((
      select json_agg(t) from (
        select pais_codigo as codigo, count(*) as n
        from meteonet_visitas where pais_codigo is not null
        group by pais_codigo order by n desc limit 6
      ) t), '[]'::json),
    'recientes', coalesce((
      select json_agg(r) from (
        select pais_codigo as codigo, ciudad, ultima as fecha
        from meteonet_visitas order by ultima desc limit 8
      ) r), '[]'::json)
  );
$$;

-- Registra visita y devuelve el resumen
create or replace function public.registrar_visita(
  p_codigo text default null,
  p_ciudad text default null
)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  hdrs json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ip text := trim(split_part(coalesce(hdrs->>'x-forwarded-for', hdrs->>'x-real-ip', ''), ',', 1));
  v_codigo text := upper(left(coalesce(nullif(trim(p_codigo), ''), hdrs->>'cf-ipcountry'), 2));
  v_ciudad text := nullif(left(trim(coalesce(p_ciudad, '')), 80), '');
  h text;
  previa record;
  nueva boolean := false;
begin
  if ip = '' then
    return (json_build_object('nueva', false)::jsonb || resumen_visitas()::jsonb)::json;
  end if;
  if v_codigo !~ '^[A-Z]{2}$' or v_codigo in ('XX', 'T1') then v_codigo := null; end if;
  h := encode(digest(ip || (select sal from meteonet_visitas_config where id = 1), 'sha256'), 'hex');

  select id, ultima into previa from meteonet_visitas
  where huella = h order by ultima desc limit 1;

  if previa.id is null or previa.ultima < now() - interval '6 hours' then
    insert into meteonet_visitas (huella, pais_codigo, ciudad) values (h, v_codigo, v_ciudad);
    nueva := true;
  else
    update meteonet_visitas set ultima = now(),
      pais_codigo = coalesce(meteonet_visitas.pais_codigo, v_codigo),
      ciudad = coalesce(meteonet_visitas.ciudad, v_ciudad)
    where id = previa.id;
  end if;

  return (json_build_object('nueva', nueva)::jsonb || resumen_visitas()::jsonb)::json;
end;
$$;

grant usage on schema public to anon, authenticated;
revoke all on function public.registrar_visita(text, text) from public;
revoke all on function public.resumen_visitas() from public;
grant execute on function public.registrar_visita(text, text) to anon, authenticated;
grant execute on function public.resumen_visitas() to anon, authenticated;

commit;

notify pgrst, 'reload schema';

