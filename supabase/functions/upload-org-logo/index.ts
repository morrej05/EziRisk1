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
      return respond(401, { error: "Missing or malformed Authorization header" });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { user, error: authError } = await requireAuthenticatedUser(supabaseClient, req);
    if (authError || !user) {
      return respond(401, { error: authError ?? "Unauthorized" });
    }

    const formData = await req.formData();
    const file = formData.get("logo") as File;
    const orgId = formData.get("organisation_id") as string;

    console.log("[upload-org-logo] organisation_id:", orgId ?? null);

    if (!file) {
      return respond(400, { error: "No file provided" });
    }

    if (!orgId) {
      return respond(400, { error: "No organisation_id provided" });
    }

    const canManageLogo = await hasRequiredOrganisationRole(supabaseClient, user.id, orgId, ["owner", "admin"]);
    if (!canManageLogo) {
      return respond(403, { error: "Only active organisation owner/admin members can upload logos" });
    }

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      return respond(400, { error: "Invalid file type. Only PNG, JPG, and SVG are allowed." });
    }

    const maxSize = 1024 * 1024;
    if (file.size > maxSize) {
      return respond(400, { error: "File too large. Maximum size is 1MB." });
    }

    const fileExt = file.name.split(".").pop();
    const fileName = `logo.${fileExt}`;
    const filePath = `org-logos/${orgId}/${fileName}`;

    const fileBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabaseClient.storage
      .from("org-assets")
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return respond(400, { error: `Upload failed: ${uploadError.message}` });
    }

    const { error: updateError } = await supabaseClient
      .from("organisations")
      .update({
        branding_logo_path: filePath,
        branding_updated_at: new Date().toISOString(),
      })
      .eq("id", orgId);

    if (updateError) {
      return respond(400, { error: `Failed to update organisation: ${updateError.message}` });
    }

    return respond(200, { success: true, path: filePath });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[upload-org-logo] unhandled error:", error);
    return respond(500, { error: message });
  }
});
