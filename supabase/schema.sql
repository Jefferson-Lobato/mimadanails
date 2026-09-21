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

  -- CORREÇÃO 1: Usando RETURNING id (apenas o nome da coluna da tabela) para a variável v_id
  insert into public.appointments(cliente_id, data, hora_inicio, hora_fim, duracao_total, valor_total)
  values(auth.uid(), p_date, p_start, v_end, v_duration, v_price) 
  returning public.appointments.id into v_id;

  for v_service in select s.id, s.duracao_minutos, s.preco from public.services s where s.id=any(p_service_ids) and s.ativo order by array_position(p_service_ids, s.id)
  loop
    v_idx:=v_idx+1;
    insert into public.appointment_services(appointment_id, service_id, ordem, duracao_minutos, preco)
    values(v_id, v_service.id, v_idx, v_service.duracao_minutos, v_service.preco);
  end loop;

  -- CORREÇÃO 2: Retornando explicitamente mapeado para evitar o erro de ambiguidade com a RETURNS TABLE
  return query select v_id as id, p_date as data, p_start as hora_inicio, v_end as hora_fim;
end;
$$;
