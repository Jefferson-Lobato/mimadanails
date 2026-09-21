-- ==========================================
-- 1. EXTENSÕES, ENUMS E ESTRUTURA DE TABELAS
-- ==========================================

create extension if not exists btree_gist;

create type public.user_role as enum ('cliente','admin');
create type public.appointment_status as enum ('agendado','cancelado','concluido');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_completo text not null,
  telefone text not null,
  role public.user_role not null default 'cliente',
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text default '',
  duracao_minutos integer not null check (duracao_minutos > 0),
  preco numeric(10,2) not null default 0 check (preco >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profiles(id),
  data date not null,
  hora_inicio time not null,
  hora_fim time not null,
  duracao_total integer not null,
  valor_total numeric(10,2) not null default 0,
  status public.appointment_status not null default 'agendado',
  observacao text default '',
  created_at timestamptz not null default now(),
  check (hora_fim > hora_inicio)
);

create table if not exists public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id),
  ordem integer not null,
  duracao_minutos integer not null,
  preco numeric(10,2) not null default 0
);

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  dia_semana integer unique not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fim time not null,
  ativo boolean not null default true,
  check (hora_fim > hora_inicio)
);

create table if not exists public.blocked_periods (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  hora_inicio time not null,
  hora_fim time not null,
  motivo text default '',
  created_at timestamptz not null default now(),
  check (hora_fim > hora_inicio)
);

-- Índices para performance
create index if not exists idx_appointments_date on public.appointments(data);
create index if not exists idx_appointments_client on public.appointments(cliente_id);

-- Carga inicial de horários de funcionamento
insert into public.business_hours(dia_semana,hora_inicio,hora_fim,ativo)
values
(0,'08:00','18:00',false),(1,'08:00','18:00',true),(2,'08:00','18:00',true),
(3,'08:00','18:00',true),(4,'08:00','18:00',true),(5,'08:00','18:00',true),(6,'08:00','13:00',true)
on conflict(dia_semana) do nothing;


-- ==========================================
-- 2. SEGURANÇA E POLÍTICAS DE RLS
-- ==========================================

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;
alter table public.business_hours enable row level security;
alter table public.blocked_periods enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;

create policy "profiles own or admin select" on public.profiles for select using (id=auth.uid() or public.is_admin());
create policy "profiles own insert" on public.profiles for insert with check (id=auth.uid());
create policy "profiles own update or admin" on public.profiles for update using (id=auth.uid() or public.is_admin()) with check (id=auth.uid() or public.is_admin());

create policy "services public active read" on public.services for select using (ativo=true or public.is_admin());
create policy "services admin write" on public.services for all using (public.is_admin()) with check (public.is_admin());

create policy "appointments own/admin read" on public.appointments for select using (cliente_id=auth.uid() or public.is_admin());
create policy "appointments own/admin update" on public.appointments for update using (cliente_id=auth.uid() or public.is_admin()) with check (cliente_id=auth.uid() or public.is_admin());
create policy "appointments admin delete" on public.appointments for delete using (public.is_admin());

create policy "appointment services own/admin read" on public.appointment_services for select using (
  public.is_admin() or exists(select 1 from public.appointments a where a.id=appointment_id and a.cliente_id=auth.uid())
);

create policy "hours public read" on public.business_hours for select using (true);
create policy "hours admin write" on public.business_hours for all using (public.is_admin()) with check (public.is_admin());

create policy "blocks public read" on public.blocked_periods for select using (true);
create policy "blocks admin write" on public.blocked_periods for all using (public.is_admin()) with check (public.is_admin());


-- ==========================================
-- 3. TRIGGERS
-- ==========================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,nome_completo,telefone)
  values(new.id, coalesce(new.raw_user_meta_data->>'nome_completo','Cliente'), coalesce(new.raw_user_meta_data->>'telefone',''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();


-- ==========================================
-- 4. FUNÇÕES DE AGENDAMENTO (CORRIGIDAS)
-- ==========================================

create or replace function public.create_appointment(
  p_date date,
  p_start time,
  p_service_ids uuid[]
)
returns table(id uuid, data date, hora_inicio time, hora_fim time)
language plpgsql security definer set search_path=public
as $$
declare
  v_duration integer;
  v_price numeric(10,2);
  v_end time;
  v_id uuid;
  v_idx integer := 0;
  v_service record;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if array_length(p_service_ids,1) is null or array_length(p_service_ids,1)=0 then raise exception 'Selecione serviços'; end if;

  select coalesce(sum(s.duracao_minutos),0), coalesce(sum(s.preco),0)
  into v_duration, v_price 
  from public.services s 
  where s.id = any(p_service_ids) and s.ativo = true;

  if v_duration <= 0 then raise exception 'Serviço inválido'; end if;
  v_end := p_start + make_interval(mins=>v_duration);

  if exists(select 1 from public.business_hours h where h.dia_semana=extract(dow from p_date)::int and h.ativo and p_start>=h.hora_inicio and v_end<=h.hora_fim) = false then
    raise exception 'Horário fora do expediente';
  end if;

  if exists(select 1 from public.blocked_periods b where b.data=p_date and p_start<b.hora_fim and v_end>b.hora_inicio) then
    raise exception 'Horário bloqueado';
  end if;

  if exists(select 1 from public.appointments a where a.data=p_date and a.status='agendado' and p_start<a.hora_fim and v_end>a.hora_inicio) then
    raise exception 'Horário já ocupado';
  end if;

  insert into public.appointments(cliente_id,data,hora_inicio,hora_fim,duracao_total,valor_total)
  values(auth.uid(),p_date,p_start,v_end,v_duration,v_price) 
  returning id into v_id;

  for v_service in select s.id, s.duracao_minutos, s.preco from public.services s where s.id=any(p_service_ids) and s.ativo order by array_position(p_service_ids,s.id)
  loop
    v_idx:=v_idx+1;
    insert into public.appointment_services(appointment_id,service_id,ordem,duracao_minutos,preco)
    values(v_id,v_service.id,v_idx,v_service.duracao_minutos,v_service.preco);
  end loop;

  return query select v_id as id, p_date as data, p_start as hora_inicio, v_end as hora_fim;
end;
$$;


create or replace function public.admin_upsert_appointment(
  p_date date,
  p_start time,
  p_service_ids uuid[],
  p_client_id uuid,
  p_existing_id uuid default null
)
returns table(id uuid)
language plpgsql security definer set search_path=public
as $$
declare 
  v_duration integer; 
  v_price numeric(10,2); 
  v_end time; 
  v_id uuid; 
  v_idx integer:=0; 
  r record;
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  if array_length(p_service_ids,1) is null or array_length(p_service_ids,1)=0 then raise exception 'Selecione serviços'; end if;
  
  select coalesce(sum(s.duracao_minutos),0), coalesce(sum(s.preco),0) 
  into v_duration, v_price 
  from public.services s 
  where s.id = any(p_service_ids) and s.ativo;
  
  v_end := p_start + make_interval(mins=>v_duration);
  
  if exists(select 1 from public.appointments a where a.data=p_date and a.status='agendado' and a.id is distinct from p_existing_id and p_start<a.hora_fim and v_end>a.hora_inicio) then 
    raise exception 'Horário já ocupado'; 
  end if;

  if p_existing_id is null then
    insert into public.appointments(cliente_id,data,hora_inicio,hora_fim,duracao_total,valor_total) 
    values(p_client_id,p_date,p_start,v_end,v_duration,v_price) 
    returning id into v_id;
  else
    update public.appointments 
    set cliente_id=p_client_id, data=p_date, hora_inicio=p_start, hora_fim=v_end, duracao_total=v_duration, valor_total=v_price 
    where public.appointments.id = p_existing_id 
    returning id into v_id;
    
    delete from public.appointment_services where appointment_id = v_id;
  end if;

