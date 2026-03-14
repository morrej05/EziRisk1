import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getBearerToken } from "../_shared/auth.ts";
import { enforceAiEndpointProtection } from "../_shared/aiProtection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PortfolioAiPayload {
  selectedWindowDays: 30 | 90;
  scope: {
    client: string | null;
    disciplineOrType: string | null;
    siteQuery: string;
    windowDays: 30 | 90;
  };
  summary: {
    totalSites: number;
    totalAssessments: number;
    totalActions: number;
    openP1Actions: number;
    updatedWithinWindowDays: number;
    createdCurrentWindow: number;
    createdPreviousWindow: number;
    updatedCurrentWindow: number;
    updatedPreviousWindow: number;
    openReRecommendations: number;
    openHighPriorityReRecommendations: number;
  };
  assessmentTrends: {
    createdCurrentWindow: number;
    createdPreviousWindow: number;
    updatedCurrentWindow: number;
    updatedPreviousWindow: number;
  };
  remediationTrends: {
    bySource: Array<{
      sourceType: 'assessment_action' | 're_recommendation';
      sourceLabel: string;
      discipline?: 'fra' | 'fsd' | 'dsear' | 'risk_engineering';
      totalOpen: number;
      openedCurrentWindow: number;
      openedPreviousWindow: number;
      closedCurrentWindow: number;
      closedPreviousWindow: number;
      urgentOpen?: number;
    }>;
    combined?: {
      totalOpen: number;
      netFlowCurrentWindow: number;
      netFlowPreviousWindow: number;
      safeToCombine: boolean;
      caveat: string;
    };
  };
  assessmentActionAgeing: {
    bucket_0_30: number;
    bucket_31_60: number;
    bucket_61_90: number;
    bucket_90_plus: number;
  };
  reRecommendationAgeing: {
    bucket_0_30: number;
    bucket_31_60: number;
    bucket_61_90: number;
    bucket_90_plus: number;
  };
  assessmentActionVelocity: {
    openedCurrentWindow: number;
    closedCurrentWindow: number;
    netChange: number;
  };
  reRecommendationVelocity: {
    openedCurrentWindow: number;
    closedCurrentWindow: number;
    netChange: number;
  };
  assessmentStatusDistribution: Array<{ label: string; count: number }>;
  commonActionModules: Array<{ label: string; count: number }>;
  actionProfile: {
    byPriority: Array<{ label: string; count: number }>;
    byStatus: Array<{ label: string; count: number }>;
  };
  sitesRequiringAttention: Array<{
    siteName: string;
    clientName: string;
    openActions: number;
    overdueActions: number;
    p1OpenActions: number;
  }>;
  hotspots?: {
    rankingModel: {
      type: 'weighted_burden';
      disclaimer: string;
      weights: {
        openP1AssessmentActions: number;
        openHighReRecommendations: number;
        ageing90PlusItems: number;
        totalOpenItems: number;
      };
    };
    topSiteHotspots: Array<{
      siteName: string;
      clientName: string;
      openP1AssessmentActions: number;
      openHighReRecommendations: number;
      ageing90PlusItems: number;
      totalOpenItems: number;
      hotspotScore: number;
    }>;
    topModuleHotspots: Array<{
      moduleKey: string;
      openP1AssessmentActions: number;
      openHighReRecommendations: number;
      ageing90PlusItems: number;
      totalOpenItems: number;
      openAssessmentActions: number;
      openReRecommendations: number;
      moduleAlignmentNote: string;
      hotspotScore: number;
    }>;
    topClientHotspots?: Array<{
      clientName: string;
      openP1AssessmentActions: number;
      openHighReRecommendations: number;
      ageing90PlusItems: number;
      totalOpenItems: number;
      hotspotScore: number;
    }>;
  };
}

interface PortfolioInsightRequest {
  portfolio: PortfolioAiPayload;
}

interface PortfolioAiInsights {
  summary: string;
  concentrations: string[];
  priorities: string[];
  draftCommentary: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing or invalid authorization bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const protection = await enforceAiEndpointProtection(
      supabase,
      req,
      "generate-portfolio-insights",
      12,
      60_000,
    );

    if (!protection.ok) {
      const payload = await protection.response.text();
      const retryAfter = protection.response.headers.get("Retry-After");
      return new Response(payload, {
        status: protection.response.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          ...(retryAfter ? { "Retry-After": retryAfter } : {}),
        },
      });
    }
    const { portfolio }: PortfolioInsightRequest = await req.json();

    if (!portfolio?.summary) {
      return new Response(JSON.stringify({ error: "portfolio aggregate payload is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a risk-engineering portfolio assistant.
You must only interpret the aggregate portfolio data provided.

Non-negotiable rules:
- Use only provided data fields and counts.
- Treat this as a scoped portfolio slice when scope values are set; do not generalise to organisation-wide conclusions.
- Treat assessment actions and risk engineering recommendations as distinct remediation source models unless payload explicitly says safeToCombine=true.
- Do not infer or mention claims, premium, underwriting outcomes, loss ratios, compliance certification, or causes.
- Do not invent risk scores, bands, trends, or confidence levels if not explicitly included.
- If hotspot ranking is present, describe it only as a remediation burden prioritisation heuristic.
- If discussing remediation trends, comment on each remediation source separately where possible.
- Do not imply causal engineering outcomes from count movement alone.
- Phrase outputs as decision support for review, not definitive conclusions.
- If data is limited, say so briefly.
- Keep tone concise, professional, and non-alarmist.`;

    const userPrompt = `Generate JSON output with exactly these keys:
- summary (string, 2-3 sentences max)
- concentrations (array of 2-4 bullets)
- priorities (array of 2-4 bullets)
- draftCommentary (string, 1 concise paragraph suitable for management/client draft use)

Output requirements:
1) Summary must reference only current aggregate counts.
2) Concentrations must focus on distribution concentration (statuses/modules/action profile/site-attention signals).
3) Priorities must be phrased as items to review, not autonomous directives.
4) Mention data limits if stronger statements cannot be supported.
5) Do not include markdown. Return valid JSON only.
6) If remediation trend data is present, explicitly differentiate assessment actions vs risk engineering recommendations.
7) Refer to a combined remediation view only when remediationTrends.combined.safeToCombine is true.
8) Explicitly frame trend comparisons as current selectedWindowDays versus previous selectedWindowDays windows.
9) Mention current scope (client/discipline/site) briefly when provided.
10) If remediation ageing/velocity fields are present, comment on backlog build-up or reduction as count movement only (no causal, compliance, or underwriting claims).
11) If hotspot data is present, highlight concentration areas (sites/modules/clients) but do not present hotspotScore as an engineering risk score.

Portfolio aggregate payload:
${JSON.stringify(portfolio)}`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 420,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "portfolio_insights",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                concentrations: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  maxItems: 6,
                },
                priorities: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  maxItems: 6,
                },
                draftCommentary: { type: "string" },
              },
              required: ["summary", "concentrations", "priorities", "draftCommentary"],
            },
          },
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("OpenAI API error:", errorText);
      return new Response(JSON.stringify({ error: "Failed to generate portfolio insights" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiData = await openaiResponse.json();
    const rawContent = openaiData.choices?.[0]?.message?.content;

    if (!rawContent) {
      return new Response(JSON.stringify({ error: "No insight payload returned from AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const insights = JSON.parse(rawContent) as PortfolioAiInsights;

    // TODO: Attach source citations for each generated sentence from aggregate keys.
    // TODO: Add review/approval metadata for external commentary workflows.
    // TODO: Add comparative period payload support when trend windows are available.

    return new Response(JSON.stringify({ success: true, insights }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in generate-portfolio-insights:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
