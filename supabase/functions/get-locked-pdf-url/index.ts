import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  document_id: string;
}

async function hasMembershipAccess(userSupabase: ReturnType<typeof createClient>, organisationId: string, userId: string) {
  const { data: membership, error: membershipError } = await userSupabase
    .from("organisation_members")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  return { hasAccess: Boolean(membership), membershipError };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error("Missing environment variables");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: authError,
    } = await userSupabase.auth.getUser(token);

    if (authError || !user) {
      console.error("[get-locked-pdf-url] Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body: RequestBody = await req.json();
    const { document_id } = body;

    if (!document_id) {
      return new Response(
        JSON.stringify({ error: "Missing document_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[get-locked-pdf-url] User ${user.id} requesting PDF for document ${document_id}`);

    const { data: document, error: docError } = await adminSupabase
      .from("documents")
      .select("organisation_id, locked_pdf_path, issue_status")
      .eq("id", document_id)
      .maybeSingle();

    if (docError) {
      console.error("[get-locked-pdf-url] Error fetching document:", docError);
      return new Response(
        JSON.stringify({ error: "Database error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!document) {
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (document.issue_status !== "issued") {
      return new Response(
        JSON.stringify({ error: "Document must be issued before accessing locked PDF", current_status: document.issue_status }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!document.locked_pdf_path) {
      return new Response(
        JSON.stringify({ error: "No locked PDF available for this document" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!document.organisation_id) {
      return new Response(
        JSON.stringify({ error: "Document is missing organisation context" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { hasAccess, membershipError } = await hasMembershipAccess(userSupabase, document.organisation_id, user.id);

    if (membershipError) {
      console.error("[get-locked-pdf-url] Error checking membership:", membershipError);
      return new Response(
        JSON.stringify({ error: "Database error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!hasAccess) {
      console.log(`[get-locked-pdf-url] User ${user.id} not a member of organisation ${document.organisation_id}`);
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[get-locked-pdf-url] Creating signed URL for path: ${document.locked_pdf_path}`);

    const { data: signedUrlData, error: signedUrlError } = await adminSupabase.storage
      .from("document-pdfs")
      .createSignedUrl(document.locked_pdf_path, 600);

    if (signedUrlError) {
      console.error("[get-locked-pdf-url] Error creating signed URL:", signedUrlError);
      return new Response(
        JSON.stringify({ error: "Failed to create signed URL" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!signedUrlData?.signedUrl) {
      return new Response(
        JSON.stringify({ error: "Failed to generate signed URL" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[get-locked-pdf-url] Success! Signed URL created for user ${user.id}`);

    return new Response(
      JSON.stringify({ signed_url: signedUrlData.signedUrl }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[get-locked-pdf-url] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
