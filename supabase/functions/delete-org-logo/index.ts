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
    const rawAuthHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!rawAuthHeader) {
      console.warn("[delete-org-logo] missing authorization header");
      return respond(401, { error: "Missing Authorization header" });
    }

    const token = getBearerToken(req);
    if (!token) {
      console.warn("[delete-org-logo] bearer parse failure");
      return respond(401, { error: "Malformed Authorization bearer token" });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: directAuthData, error: directAuthError } = await supabaseClient.auth.getUser(token);
    const directUser = directAuthData?.user ?? null;
    if (directAuthError) {
      console.warn("[delete-org-logo] auth.getUser(token) failure", {
        message: directAuthError.message,
      });
    }

    const { data: headerAuthData, error: headerAuthError } = directUser
      ? { data: { user: null }, error: null }
      : await supabaseClient.auth.getUser();
    const user = directUser ?? headerAuthData?.user ?? null;

    if (!directUser && directAuthError && !headerAuthData?.user && !headerAuthError) {
      console.warn("[delete-org-logo] auth.getUser(token) failure", {
        message: directAuthError.message,
      });
      return respond(401, { error: `auth.getUser(token) failed: ${directAuthError.message}` });
    }

    if (!directUser && headerAuthError) {
      console.warn("[delete-org-logo] auth.getUser() fallback failure", {
        message: headerAuthError.message,
      });
      return respond(401, { error: `auth.getUser() fallback failed: ${headerAuthError.message}` });
    }

    if (!user) {
      console.warn("[delete-org-logo] auth user missing after token + fallback checks");
      return respond(401, { error: "Unauthorized" });
    }

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
      console.warn("[delete-org-logo] missing organisation_id");
      return respond(400, { error: "No organisation_id provided" });
    }

    const { data: org, error: orgError } = await supabaseClient
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

    const { data: membership, error: membershipError } = await supabaseClient
      .from("organisation_members")
      .select("role, status")
      .eq("organisation_id", organisation_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (membershipError || !membership) {
      console.warn("[delete-org-logo] no organisation_members row", {
        userId: user.id,
        organisation_id,
        membershipError: membershipError?.message ?? null,
      });
      return respond(403, { error: "No active organisation membership found" });
    }

    if (!["owner", "admin"].includes(membership.role)) {
      console.warn("[delete-org-logo] role not owner/admin", {
        userId: user.id,
        organisation_id,
        role: membership.role,
      });
      return respond(403, { error: "Role not permitted: owner/admin required" });
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
