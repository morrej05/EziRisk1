import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

type PlanId = "standard" | "professional";
type PlanInterval = "month" | "year";

interface ChangeSubscriptionPlanRequest {
  organisationId: string;
  targetPlan: PlanId;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getPlanPriceId(targetPlan: PlanId, interval: PlanInterval): string | null {
  if (targetPlan === "professional") {
    return interval === "year"
      ? (Deno.env.get("STRIPE_PRICE_PRO_ANNUAL") ?? null)
      : (Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? null);
  }

  return interval === "year"
    ? (Deno.env.get("STRIPE_PRICE_STANDARD_ANNUAL") ?? null)
    : (Deno.env.get("STRIPE_PRICE_STANDARD_MONTHLY") ?? null);
}

function resolveInterval(subscription: Stripe.Subscription): PlanInterval {
  const interval = subscription.items.data[0]?.price.recurring?.interval;
  return interval === "year" ? "year" : "month";
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

    const authorization = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authorization) {
      return jsonResponse(401, { error: "Missing Authorization header" });
    }

    const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
    });

    const { data: { user }, error: authError } = await authSupabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { organisationId, targetPlan }: ChangeSubscriptionPlanRequest = await req.json();

    if (!organisationId || !targetPlan) {
      return jsonResponse(400, { error: "Missing required parameters: organisationId, targetPlan" });
    }

    if (!['standard', 'professional'].includes(targetPlan)) {
      return jsonResponse(400, { error: "Invalid targetPlan" });
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: membership, error: membershipError } = await adminSupabase
      .from("organisation_members")
      .select("role, status")
      .eq("organisation_id", organisationId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (membershipError) {
      return jsonResponse(500, { error: "Failed to verify organisation membership" });
    }

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return jsonResponse(403, { error: "Only organisation owners/admins can manage plan changes" });
    }

    const { data: organisation, error: orgError } = await adminSupabase
      .from("organisations")
      .select("id, plan_id, stripe_subscription_id")
      .eq("id", organisationId)
      .maybeSingle();

    if (orgError) {
      return jsonResponse(500, { error: "Failed to fetch organisation" });
    }

    if (!organisation) {
      return jsonResponse(404, { error: "Organisation not found" });
    }

    if (!organisation.stripe_subscription_id) {
      return jsonResponse(400, { error: "No active Stripe subscription linked to this organisation" });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-11-20.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const subscription = await stripe.subscriptions.retrieve(organisation.stripe_subscription_id, {
      expand: ["items.data.price", "schedule"],
    });

    if (subscription.status !== "active" && subscription.status !== "trialing") {
      return jsonResponse(400, { error: `Subscription is not active (status=${subscription.status})` });
    }

    const subscriptionItem = subscription.items.data[0];
    if (!subscriptionItem) {
      return jsonResponse(400, { error: "No active subscription item found" });
    }

    const interval = resolveInterval(subscription);
    const targetPriceId = getPlanPriceId(targetPlan, interval);

    if (!targetPriceId) {
      return jsonResponse(500, { error: `Missing Stripe price env var for ${targetPlan} (${interval})` });
    }

    if (targetPlan === "professional") {
      const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
        proration_behavior: "create_prorations",
        items: [{ id: subscriptionItem.id, price: targetPriceId }],
      });

      return jsonResponse(200, {
        message: "Subscription upgraded to Professional with proration",
        mode: "upgrade_immediate_prorated",
        subscriptionId: updatedSubscription.id,
      });
    }

    const currentPriceId = subscriptionItem.price.id;
    const currentPeriodEnd = subscription.current_period_end;

    if (currentPriceId === targetPriceId) {
      return jsonResponse(200, {
        message: "Subscription already on Standard",
        mode: "no_change",
        subscriptionId: subscription.id,
      });
    }

    const existingScheduleId = typeof subscription.schedule === "string"
      ? subscription.schedule
      : subscription.schedule?.id;

    if (existingScheduleId) {
      await stripe.subscriptionSchedules.release(existingScheduleId);
    }

    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: subscription.id,
      end_behavior: "release",
      phases: [
        {
          start_date: "now",
          end_date: currentPeriodEnd,
          items: [{ price: currentPriceId, quantity: subscriptionItem.quantity ?? 1 }],
        },
        {
          items: [{ price: targetPriceId, quantity: subscriptionItem.quantity ?? 1 }],
        },
      ],
    });

    return jsonResponse(200, {
      message: "Downgrade to Standard scheduled for period end",
      mode: "downgrade_scheduled_period_end",
      subscriptionId: subscription.id,
      subscriptionScheduleId: schedule.id,
      effectiveAt: new Date(currentPeriodEnd * 1000).toISOString(),
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Failed to change subscription plan",
    });
  }
});
