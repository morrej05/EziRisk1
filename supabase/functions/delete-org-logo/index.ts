import { createClient } from "npm:@supabase/supabase-js@2";
import { getBearerToken, requireAuthenticatedUser } from "../_shared/auth.ts";
import { hasRequiredOrganisationRole } from "../_shared/orgAuth.ts";

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
    const token = getBearerToken(req);
    if (!token) {
      console.warn("[delete-org-logo] Missing or malformed Authorization header");
      return respond(401, { error: "Missing or malformed Authorization header" });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { user, error: authError } = await requireAuthenticatedUser(supabaseClient, req);
    if (authError || !user) {
      console.warn("[delete-org-logo] auth.getUser(token) failed", { authError: authError ?? "Unauthorized" });
      return respond(401, { error: authError ?? "Unauthorized" });
    }

    const { organisation_id } = await req.json();

    if (!organisation_id) {
      return respond(400, { error: "No organisation_id provided" });
    }

    const canManageLogo = await hasRequiredOrganisationRole(supabaseClient, user.id, organisation_id, ["owner", "admin"]);
    if (!canManageLogo) {
      return respond(403, { error: "Only active organisation owner/admin members can delete logos" });
    }

    const { data: org, error: orgError } = await supabaseClient
      .from("organisations")
      .select("branding_logo_path")
      .eq("id", organisation_id)
      .maybeSingle();

    if (orgError || !org) {
      return respond(404, { error: "Organisation not found" });
    }

    if (org.branding_logo_path) {
      const { error: deleteError } = await supabaseClient.storage
        .from("org-assets")
        .remove([org.branding_logo_path]);

      if (deleteError) {
        console.error("Storage delete error:", deleteError);
      }
    }

    const { error: updateError } = await supabaseClient
      .from("organisations")
      .update({
        branding_logo_path: null,
        branding_updated_at: new Date().toISOString(),
      })
      .eq("id", organisation_id);

    if (updateError) {
      return respond(400, { error: `Failed to update organisation: ${updateError.message}` });
    }

    return respond(200, { success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[delete-org-logo] unhandled error:", error);
    return respond(500, { error: message });
  }
});
