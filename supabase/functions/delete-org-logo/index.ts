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

  try {
    const token = getBearerToken(req);
    if (!token) {
      throw new Error("Missing authorization header");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { user, error: authError } = await requireAuthenticatedUser(supabaseClient, req);
    if (authError || !user) {
      throw new Error(authError ?? "Unauthorized");
    }

    const { organisation_id } = await req.json();

    if (!organisation_id) {
      throw new Error("No organisation_id provided");
    }

    const canManageLogo = await hasRequiredOrganisationRole(supabaseClient, user.id, organisation_id, ["owner", "admin"]);
    if (!canManageLogo) {
      throw new Error("Only active organisation owner/admin members can delete logos");
    }

    const { data: org, error: orgError } = await supabaseClient
      .from("organisations")
      .select("branding_logo_path")
      .eq("id", organisation_id)
      .maybeSingle();

    if (orgError || !org) {
      throw new Error("Organisation not found");
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
      throw new Error(`Failed to update organisation: ${updateError.message}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
