import { createClient } from "npm:@supabase/supabase-js@2";
import { getBearerToken } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const respond = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), { status, headers: jsonHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const token = getBearerToken(req);
    if (!token) {
      console.warn("[delete-org-logo] no auth header");
      return respond(401, { error: "Missing or malformed Authorization header" });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);

    if (authError) {
      console.warn("[delete-org-logo] auth.getUser failed", { message: authError.message });
      return respond(401, { error: "Unauthorized" });
    }

    if (!user) {
      console.warn("[delete-org-logo] no user");
      return respond(401, { error: "Unauthorized" });
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const contentType = req.headers.get("content-type") ?? "";
    let organisation_id: string | null = null;
    if (contentType.includes("application/json")) {
      const jsonBody = await req.json();
      organisation_id = jsonBody?.organisation_id ?? jsonBody?.organisationId ?? null;
    } else {
      const formData = await req.formData();
      organisation_id = (formData.get("organisation_id") ?? formData.get("organisationId")) as string | null;
    }

    if (!organisation_id) {
      console.warn("[delete-org-logo] missing organisation_id", { userId: user.id });
      return respond(400, { error: "No organisation_id provided" });
    }

    const { data: membership, error: membershipError } = await serviceClient
      .from("organisation_members")
      .select("role, status")
      .eq("organisation_id", organisation_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (membershipError || !membership) {
      console.warn("[delete-org-logo] no membership row", {
        userId: user.id,
        organisation_id,
        membershipError: membershipError?.message ?? null,
      });
      return respond(403, { error: "No active organisation membership found" });
    }

    if (![
      "owner",
      "admin",
    ].includes(membership.role)) {
      console.warn("[delete-org-logo] role denied", {
        userId: user.id,
        organisation_id,
        role: membership.role,
      });
      return respond(403, { error: "Role not permitted: owner/admin required" });
    }

    const { data: org, error: orgError } = await serviceClient
      .from("organisations")
      .select("id, branding_logo_path")
      .eq("id", organisation_id)
      .maybeSingle();

    if (orgError || !org) {
      console.warn("[delete-org-logo] organisation not found", {
        organisation_id,
        message: orgError?.message ?? null,
      });
      return respond(404, { error: "Organisation not found" });
    }

    if (!org.branding_logo_path) {
      console.info("[delete-org-logo] no branding_logo_path", { organisation_id, userId: user.id });
    } else {
      const { error: deleteError } = await serviceClient.storage
        .from("org-assets")
        .remove([org.branding_logo_path]);

      if (deleteError) {
        console.error("[delete-org-logo] storage remove failed", {
          organisation_id,
          path: org.branding_logo_path,
          message: deleteError.message,
        });
        return respond(500, { error: `Failed to delete logo from storage: ${deleteError.message}` });
      }
    }

    const { error: updateError } = await serviceClient
      .from("organisations")
      .update({
        branding_logo_path: null,
        branding_updated_at: new Date().toISOString(),
      })
      .eq("id", organisation_id);

    if (updateError) {
      console.error("[delete-org-logo] DB update failed", {
        organisation_id,
        message: updateError.message,
      });
      return respond(500, { error: `Failed to update organisation: ${updateError.message}` });
    }

    return respond(200, { success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[delete-org-logo] unhandled error:", error);
    return respond(500, { error: message });
  }
});
