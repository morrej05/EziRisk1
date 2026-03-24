import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import { getBearerToken } from "../_shared/auth.ts";
import { hasRequiredOrganisationRole } from "../_shared/orgAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PortalSessionRequest {
  organisationId: string;
  returnUrl: string;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse(500, {
        error: "STRIPE_SECRET_KEY/SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY must be configured",
      });
    }

    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse(401, { error: "Missing or malformed Authorization header" });
    }

    const authSupabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authSupabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse(401, { error: "Failed to validate authenticated user" });
    }

    const { organisationId, returnUrl }: PortalSessionRequest = await req.json();

    if (!organisationId) {
      return jsonResponse(400, { error: "Missing required parameter: organisationId" });
    }

    if (!returnUrl || !isValidHttpUrl(returnUrl)) {
      return jsonResponse(400, { error: "Missing or invalid required parameter: returnUrl" });
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: organisation, error: orgError } = await adminSupabase
      .from("organisations")
      .select("id, stripe_customer_id")
      .eq("id", organisationId)
      .single();

    if (orgError || !organisation) {
      return jsonResponse(404, { error: "Organisation not found" });
    }

    const { data: membership, error: membershipError } = await adminSupabase
      .from("organisation_members")
      .select("role, status")
      .eq("organisation_id", organisationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      return jsonResponse(500, { error: "Failed to verify organisation membership" });
    }

    if (!membership || membership.status !== "active") {
      return jsonResponse(401, { error: "Active organisation membership is required to manage billing" });
    }

    const canManageBilling = await hasRequiredOrganisationRole(
      adminSupabase,
      user.id,
      organisationId,
      ["owner", "admin"],
    );

    if (!canManageBilling) {
      return jsonResponse(401, { error: "Only organisation owners/admins can manage billing" });
    }

    if (!organisation.stripe_customer_id) {
      return jsonResponse(400, { error: "No Stripe customer is linked to this organisation" });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-11-20.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: organisation.stripe_customer_id,
      return_url: returnUrl,
    });

    return jsonResponse(200, { portalUrl: portalSession.url, url: portalSession.url });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Failed to create Stripe portal session",
    });
  }
});
