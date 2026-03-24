import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import { getBearerToken } from "../_shared/auth.ts";
import { hasRequiredOrganisationRole } from '../_shared/orgAuth.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CheckoutRequest {
  priceId: string;
  organisationId: string;
  successUrl: string;
  cancelUrl: string;
}

type PlanId = "standard" | "professional";
type PlanInterval = "month" | "year";

interface StripePlanMapping {
  planId: PlanId;
  interval: PlanInterval;
}

const STRIPE_PRICE_STANDARD_MONTHLY =
  Deno.env.get("STRIPE_PRICE_STANDARD_MONTHLY") || Deno.env.get("STRIPE_PRICE_CORE_MONTHLY");
const STRIPE_PRICE_STANDARD_ANNUAL =
  Deno.env.get("STRIPE_PRICE_STANDARD_ANNUAL") || Deno.env.get("STRIPE_PRICE_CORE_ANNUAL");

const PRICE_TO_PLAN: Record<string, StripePlanMapping> = {
  [STRIPE_PRICE_STANDARD_MONTHLY || ""]: { planId: "standard", interval: "month" },
  [STRIPE_PRICE_STANDARD_ANNUAL || ""]: { planId: "standard", interval: "year" },
  [Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") || ""]: { planId: "professional", interval: "month" },
  [Deno.env.get("STRIPE_PRICE_PRO_ANNUAL") || ""]: { planId: "professional", interval: "year" },
};

function getPlanFromPriceId(priceId: string): StripePlanMapping | null {
  return PRICE_TO_PLAN[priceId] || null;
}

const ALLOWED_PRICE_IDS = new Set(
  [
    STRIPE_PRICE_STANDARD_MONTHLY,
    STRIPE_PRICE_STANDARD_ANNUAL,
    Deno.env.get("STRIPE_PRICE_PRO_MONTHLY"),
    Deno.env.get("STRIPE_PRICE_PRO_ANNUAL"),
  ].filter((value): value is string => Boolean(value)),
);

interface TokenProjectInfo {
  issuer: string | null;
  projectRefFromIssuer: string | null;
}

function parseJwtProjectInfo(token: string): TokenProjectInfo {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return { issuer: null, projectRefFromIssuer: null };
    }

    const payloadBase64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const padded = payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, '=');
    const payloadRaw = atob(padded);
    const payload = JSON.parse(payloadRaw) as { iss?: string };
    const issuer = payload.iss ?? null;

    const projectRefFromIssuer = issuer?.match(/^https:\/\/([^.]+)\.supabase\.co\/?$/)?.[1] ?? null;
    return { issuer, projectRefFromIssuer };
  } catch {
    return { issuer: null, projectRefFromIssuer: null };
  }
}

function getProjectRefFromSupabaseUrl(url: string): string | null {
  return url.match(/^https:\/\/([^.]+)\.supabase\.co\/?$/)?.[1] ?? null;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const requestId = req.headers.get("x-request-id")
    ?? req.headers.get("x-nf-request-id")
    ?? crypto.randomUUID();

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("[create-checkout-session] Missing STRIPE_SECRET_KEY", { requestId });
      return jsonResponse(500, { error: "STRIPE_SECRET_KEY not configured", requestId });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = getBearerToken(req);
    if (!token) {
      console.warn("[create-checkout-session] Missing bearer token", { requestId });
      return jsonResponse(401, { error: "Missing or malformed Authorization header", requestId });
    }

    const urlProjectRef = getProjectRefFromSupabaseUrl(supabaseUrl);
    const { issuer, projectRefFromIssuer } = parseJwtProjectInfo(token);

    if (projectRefFromIssuer && urlProjectRef && projectRefFromIssuer !== urlProjectRef) {
      console.error("[create-checkout-session] JWT issuer project mismatch", {
        requestId,
        issuer,
        tokenProjectRef: projectRefFromIssuer,
        functionProjectRef: urlProjectRef,
      });
      return jsonResponse(401, {
        error: "JWT issuer does not match function project",
        requestId,
        tokenProjectRef: projectRefFromIssuer,
        functionProjectRef: urlProjectRef,
      });
    }

    const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await authSupabase.auth.getUser();

    if (authError || !user) {
      console.error("[create-checkout-session] Auth rejected bearer token", {
        requestId,
        authError: authError?.message ?? null,
        issuer,
        tokenProjectRef: projectRefFromIssuer,
        functionProjectRef: urlProjectRef,
      });
      return jsonResponse(401, {
        error: "Invalid JWT",
        reason: authError?.message ?? "No user returned",
        requestId,
      });
    }

    const { priceId, organisationId, successUrl, cancelUrl }: CheckoutRequest = await req.json();

    if (!priceId || !organisationId) {
      return jsonResponse(400, { error: "Missing required parameters", requestId });
    }

    if (!ALLOWED_PRICE_IDS.has(priceId)) {
      return jsonResponse(400, { error: "Unsupported Stripe price ID", requestId });
    }

    const planMapping = getPlanFromPriceId(priceId);
    if (!planMapping) {
      return jsonResponse(400, { error: "Unable to map Stripe price to plan", requestId });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-11-20.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: organisation, error: orgError } = await adminSupabase
      .from("organisations")
      .select("*")
      .eq("id", organisationId)
      .single();

    if (orgError || !organisation) {
      console.error("[create-checkout-session] Organisation lookup failed", {
        requestId,
        organisationId,
        orgError: orgError?.message ?? null,
      });
      return jsonResponse(404, { error: "Organisation not found", requestId });
    }

    const canManageCheckout = await hasRequiredOrganisationRole(
      adminSupabase,
      user.id,
      organisationId,
      ['owner', 'admin'],
    );

    if (!canManageCheckout) {
      return jsonResponse(403, {
        error: "Only organisation owners/admins can create checkout sessions",
        requestId,
      });
    }

    let stripeCustomerId = organisation.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          organisation_id: organisationId,
          user_id: user.id,
        },
      });
      stripeCustomerId = customer.id;

      await adminSupabase
        .from("organisations")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", organisationId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        organisation_id: organisationId,
        user_id: user.id,
        plan_id: planMapping.planId,
        plan_interval: planMapping.interval,
      },
      subscription_data: {
        metadata: {
          organisation_id: organisationId,
          user_id: user.id,
          plan_id: planMapping.planId,
          plan_interval: planMapping.interval,
        },
      },
    });

    return jsonResponse(200, { sessionUrl: session.url, url: session.url, requestId });
  } catch (error) {
    console.error("[create-checkout-session] Unhandled error", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Failed to create checkout session",
      requestId,
    });
  }
});
