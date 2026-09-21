import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { appointment_id, type } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: a, error } = await supabase
      .from("appointments")
      .select(`*, profiles(nome_completo,telefone), appointment_services(*, services(nome))`)
      .eq("id", appointment_id)
      .single();

    if (error) throw error;

    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const version = Deno.env.get("WHATSAPP_API_VERSION") || "v23.0";
    const adminPhone = Deno.env.get("WHATSAPP_ADMIN_PHONE");
    const template = type === "cancellation"
      ? Deno.env.get("WHATSAPP_CANCEL_TEMPLATE")
      : Deno.env.get("WHATSAPP_CONFIRM_TEMPLATE");
    const language = Deno.env.get("WHATSAPP_LANGUAGE") || "pt_BR";

    if (!token || !phoneId || !template) {
      return new Response(JSON.stringify({ ok: false, skipped: true, reason: "WhatsApp não configurado" }),
        { headers: { ...cors, "Content-Type": "application/json" }});
    }

    const services = (a.appointment_services || []).map((x:any) => x.services?.nome).filter(Boolean).join(", ");
    const date = new Date(a.data + "T12:00:00").toLocaleDateString("pt-BR");

    // Ajuste a ordem dos parâmetros conforme o template aprovado no Meta.
    const components = [{
      type: "body",
      parameters: [
        { type: "text", text: a.profiles.nome_completo },
        { type: "text", text: date },
        { type: "text", text: a.hora_inicio },
        { type: "text", text: services || "Serviços" },
      ]
    }];

    const recipients = [a.profiles.telefone, adminPhone].filter(Boolean);
    const results = [];

    for (const to of recipients) {
      const r = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: { name: template, language: { code: language }, components }
        })
      });
      results.push(await r.json());
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...cors, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});
