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
  Deno.env.get("STRIPE_PRICE_STANDARD_MONTHLY");
const STRIPE_PRICE_STANDARD_ANNUAL =
  Deno.env.get("STRIPE_PRICE_STANDARD_ANNUAL");

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

function logAndRespond(
  status: number,
  requestId: string,
  reason: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const logPayload = {
    requestId,
    reason,
    ...details,
  };

  if (status >= 500) {
    console.error("[create-checkout-session] Request failed", logPayload);
  } else if (status >= 400) {
    console.warn("[create-checkout-session] Request rejected", logPayload);
  } else {
    console.log("[create-checkout-session] Request info", logPayload);
  }

  return jsonResponse(status, {
    error: message,
    reason,
    requestId,
  });
}

function classifyAuthFailure(authErrorMessage: string | null, hasUser: boolean) {
  if (!authErrorMessage && !hasUser) {
    return {
      reason: "auth_user_missing",
      message: "Authenticated user was not returned",
    };
  }

  const normalized = authErrorMessage?.toLowerCase() ?? "";

  if (normalized.includes("expired")) {
    return {
      reason: "auth_jwt_expired",
      message: "JWT has expired",
    };
  }

  if (normalized.includes("signature")) {
    return {
      reason: "auth_jwt_signature_invalid",
      message: "JWT signature validation failed",
    };
  }

  if (normalized.includes("invalid jwt") || normalized.includes("jwt")) {
    return {
      reason: "auth_invalid_jwt",
      message: "JWT validation failed",
    };
  }

  return {
    reason: "auth_get_user_failed",
    message: "Failed to validate authenticated user",
  };
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
      return logAndRespond(500, requestId, "missing_stripe_secret", "STRIPE_SECRET_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const viteSupabaseAnonKey = Deno.env.get("VITE_SUPABASE_ANON_KEY");
    const legacyAnon = Deno.env.get("ANON");

    const envPresence = {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseAnonKey: Boolean(supabaseAnonKey),
      hasViteSupabaseAnonKey: Boolean(viteSupabaseAnonKey),
      hasAnon: Boolean(legacyAnon),
      hasSupabaseServiceRoleKey: Boolean(supabaseServiceKey),
    };

    console.log("[create-checkout-session] Auth env presence", {
      requestId,
      ...envPresence,
      authClientEnvSource: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
    });

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return logAndRespond(
        500,
        requestId,
        "missing_supabase_secrets",
        "SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY must be configured",
        envPresence,
      );
    }

    const token = getBearerToken(req);
    if (!token) {
      return logAndRespond(
        401,
        requestId,
        "missing_bearer_token",
        "Missing or malformed Authorization header",
      );
    }

    const urlProjectRef = getProjectRefFromSupabaseUrl(supabaseUrl);
    const { issuer, projectRefFromIssuer } = parseJwtProjectInfo(token);

    if (projectRefFromIssuer && urlProjectRef && projectRefFromIssuer !== urlProjectRef) {
      return logAndRespond(
        401,
        requestId,
        "jwt_project_mismatch",
        "JWT issuer does not match function project",
        {
          issuer,
          tokenProjectRef: projectRefFromIssuer,
          functionProjectRef: urlProjectRef,
        },
      );
    }

    const authSupabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authSupabase.auth.getUser(token);

    if (authError || !user) {
      const authErrorMessage = authError?.message ?? null;
      const authFailure = classifyAuthFailure(authErrorMessage, Boolean(user));

      return logAndRespond(401, requestId, authFailure.reason, authFailure.message, {
        authError: authErrorMessage,
        issuer,
        tokenProjectRef: projectRefFromIssuer,
        functionProjectRef: urlProjectRef,
        inferredEnvMismatch:
          authFailure.reason === "auth_invalid_jwt" && projectRefFromIssuer === urlProjectRef
            ? "Token project matches function project; verify SUPABASE_ANON_KEY belongs to the same project and is not stale."
            : null,
        ...envPresence,
      });
    }

    const { priceId, organisationId, successUrl, cancelUrl }: CheckoutRequest = await req.json();

    if (!priceId) {
      return logAndRespond(400, requestId, "missing_price_id", "Missing required parameter: priceId");
    }
    if (!organisationId) {
      return logAndRespond(401, requestId, "missing_org_context", "Missing required parameter: organisationId");
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
      return logAndRespond(404, requestId, "organisation_not_found", "Organisation not found", {
        organisationId,
        orgError: orgError?.message ?? null,
      });
    }

    const { data: membership, error: membershipError } = await adminSupabase
      .from("organisation_members")
      .select("role, status")
      .eq("organisation_id", organisationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      return logAndRespond(500, requestId, "membership_lookup_failed", "Failed to verify organisation membership", {
        organisationId,
        userId: user.id,
        membershipError: membershipError.message,
      });
    }

    if (!membership || membership.status !== "active") {
      return logAndRespond(
        401,
        requestId,
        "missing_org_membership",
        "Active organisation membership is required to create checkout sessions",
        {
          organisationId,
          userId: user.id,
          membershipStatus: membership?.status ?? null,
        },
      );
    }

    const canManageCheckout = await hasRequiredOrganisationRole(
      adminSupabase,
      user.id,
      organisationId,
      ['owner', 'admin'],
    );

    if (!canManageCheckout) {
      return logAndRespond(
        401,
        requestId,
        "insufficient_role",
        "Only organisation owners/admins can create checkout sessions",
        {
          organisationId,
          userId: user.id,
          membershipRole: membership.role,
        },
      );
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
