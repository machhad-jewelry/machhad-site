// Supabase Edge Function: إنشاء وحذف حسابات المشرفين (يحتاج صلاحية service_role لإدارة Supabase Auth)
// أمان: فقط المشرف الأعلى (owner) يقدر يستدعي هاي الوظيفة — نتحقق من هوية المتصل عبر الـ JWT الخاص فيه
// (verify_jwt=true بس بيتأكد إنه في JWT صالح، مش إنه فعلًا المشرف الأعلى — التحقق الحقيقي هون بالكود)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPER_ADMIN_EMAIL = "rachad.fakouri@gmail.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser(jwt);
    if (userErr || !user || user.email !== SUPER_ADMIN_EMAIL) {
      throw new Error("Forbidden — super admin only");
    }

    // عميل بصلاحية الخادم الكاملة — يتجاوز RLS عمدًا حتى يقدر يدير حسابات Supabase Auth،
    // بس هو الوحيد يلي بيقدر يستخدمه (مفتاح داخلي بالوظيفة، ما يوصل للمتصفح أبدًا)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, email, password, permissions, id } = await req.json();

    if (action === "create") {
      if (!email || !password) throw new Error("email and password are required");
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr) throw createErr;

      const { error: insertErr } = await supabaseAdmin.from("admin_users").insert({
        id: created.user.id,
        email,
        permissions: permissions ?? [],
      });
      if (insertErr) {
        // تراجع عن إنشاء حساب الدخول حتى ما يبقى حساب بدون صلاحيات معروفة
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
        throw insertErr;
      }

      return new Response(JSON.stringify({ ok: true, id: created.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      if (!id) throw new Error("id is required");
      await supabaseAdmin.from("admin_users").delete().eq("id", id);
      const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (deleteErr) throw deleteErr;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unknown action");
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
