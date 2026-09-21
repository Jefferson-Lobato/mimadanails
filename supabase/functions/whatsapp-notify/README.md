Deploy:

supabase functions deploy whatsapp-notify

Configure secrets:

supabase secrets set \
  WHATSAPP_ACCESS_TOKEN="..." \
  WHATSAPP_PHONE_NUMBER_ID="..." \
  WHATSAPP_API_VERSION="v23.0" \
  WHATSAPP_ADMIN_PHONE="5511999999999" \
  WHATSAPP_CONFIRM_TEMPLATE="agendamento_confirmado" \
  WHATSAPP_CANCEL_TEMPLATE="agendamento_cancelado" \
  WHATSAPP_LANGUAGE="pt_BR"
