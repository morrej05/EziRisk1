import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
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

const PRICE_TO_PLAN: Record<string, StripePlanMapping> = {
  [Deno.env.get("STRIPE_PRICE_CORE_MONTHLY") || ""]: { planId: "standard", interval: "month" },
  [Deno.env.get("STRIPE_PRICE_CORE_ANNUAL") || ""]: { planId: "standard", interval: "year" },
  [Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") || ""]: { planId: "professional", interval: "month" },
  [Deno.env.get("STRIPE_PRICE_PRO_ANNUAL") || ""]: { planId: "professional", interval: "year" },
};

function getPlanFromPriceId(priceId: string): StripePlanMapping | null {
  return PRICE_TO_PLAN[priceId] || null;
}

const ALLOWED_PRICE_IDS = new Set(
  [
    Deno.env.get("STRIPE_PRICE_CORE_MONTHLY"),
    Deno.env.get("STRIPE_PRICE_CORE_ANNUAL"),
    Deno.env.get("STRIPE_PRICE_PRO_MONTHLY"),
    Deno.env.get("STRIPE_PRICE_PRO_ANNUAL"),
  ].filter((value): value is string => Boolean(value)),
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-11-20.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { priceId, organisationId, successUrl, cancelUrl }: CheckoutRequest = await req.json();

    if (!priceId || !organisationId) {
      throw new Error("Missing required parameters");
    }

    if (!ALLOWED_PRICE_IDS.has(priceId)) {
      throw new Error("Unsupported Stripe price ID");
    }

    const planMapping = getPlanFromPriceId(priceId);
    if (!planMapping) {
      throw new Error("Unable to map Stripe price to plan");
    }

    const { data: organisation, error: orgError } = await supabase
      .from("organisations")
      .select("*")
      .eq("id", organisationId)
      .single();

    if (orgError || !organisation) {
      throw new Error("Organisation not found");
    }

    const canManageCheckout = await hasRequiredOrganisationRole(
      supabase,
      user.id,
      organisationId,
      ['owner', 'admin'],
    );

    if (!canManageCheckout) {
      throw new Error("Only organisation owners/admins can create checkout sessions");
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

      await supabase
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

    return new Response(
      JSON.stringify({ sessionUrl: session.url, url: session.url }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to create checkout session" }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
