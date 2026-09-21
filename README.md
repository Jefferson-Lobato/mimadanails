# Sistema de Agendamento para Manicure — Supabase

Projeto base completo usando HTML/CSS/JavaScript + Supabase.

## 1. Configurar o Supabase

1. Crie um projeto no Supabase.
2. Abra SQL Editor e execute `supabase/schema.sql`.
3. Em Authentication > Providers, deixe Email habilitado.
4. Em Authentication > URL Configuration, configure a URL do seu site.
5. Copie a URL e a anon key do projeto para `js/config.js`.

## 2. Criar o primeiro administrador

Faça cadastro normalmente pela tela. Depois, no SQL Editor, execute:

```sql
update public.profiles
set role = 'admin'
where id = 'UUID_DO_USUARIO';
```

## 3. Rodar localmente

Não abra `index.html` diretamente pelo arquivo. Use um servidor local, por exemplo:

```bash
python -m http.server 5500
```

Depois acesse `http://localhost:5500`.

## 4. WhatsApp

A integração está preparada em `supabase/functions/whatsapp-notify/index.ts`.
Para produção, configure as variáveis secretas:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_API_VERSION`
- `WHATSAPP_ADMIN_PHONE`
- `WHATSAPP_CONFIRM_TEMPLATE`
- `WHATSAPP_CANCEL_TEMPLATE`
- `WHATSAPP_LANGUAGE`

Os templates precisam existir/aprovados no WhatsApp Business da Meta.

## Funcionalidades

- Cadastro/login
- Cliente vê apenas seus agendamentos
- Serviços com duração e preço
- Seleção de vários serviços
- Soma automática da duração
- Agenda com horários disponíveis
- Bloqueio de conflitos no banco
- Cancelamento pelo cliente
- Painel administrativo
- CRUD de serviços
- Criar/editar/cancelar agendamentos
- Horários de funcionamento
- Bloqueios de agenda
- Base para notificações WhatsApp

## Observação

Este é um projeto base pronto para personalização. Antes de produção, configure domínio, SMTP/Email do Supabase, políticas de cancelamento, templates oficiais do WhatsApp e faça testes de carga/conflito.
# mimadanails
# mimadanails
