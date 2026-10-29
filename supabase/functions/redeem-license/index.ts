const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeCode(value: unknown) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^SELA-PLUS-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(code) ? code : null;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
    || Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  if (!authorization?.startsWith("Bearer ") || !publishableKey || !serviceRoleKey || !supabaseUrl) {
    return jsonResponse({ error: "License activation service is not configured." }, 500);
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }
  const code = normalizeCode(body.code);
  if (!code) {
    return jsonResponse({ error: "Format kode lisensi tidak valid." }, 400);
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: authorization },
  });
  if (!userResponse.ok) {
    return jsonResponse({ error: "Sesi login tidak valid. Silakan masuk kembali." }, 401);
  }
  const user = await userResponse.json();
  if (typeof user.id !== "string") {
    return jsonResponse({ error: "Akun tidak dapat diverifikasi." }, 401);
  }

  const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/redeem_sela_plus_code`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_code_hash: await sha256(code), p_user_id: user.id }),
  });
  if (!rpcResponse.ok) {
    const error = await rpcResponse.json().catch(() => ({}));
    const message = typeof error.message === "string" ? error.message : "";
    if (/invalid, expired, or already used/i.test(message)) {
      return jsonResponse({ error: "Kode lisensi tidak valid, kedaluwarsa, atau sudah digunakan." }, 400);
    }
    if (/already has an active/i.test(message)) {
      return jsonResponse({ error: "Akun ini sudah memiliki lisensi Sela Plus Lifetime aktif." }, 409);
    }
    console.error("License redemption failed.", rpcResponse.status, error);
    return jsonResponse({ error: "Lisensi belum dapat diaktifkan. Coba lagi atau hubungi admin." }, 500);
  }

  return jsonResponse({ activated: true }, 200);
});
