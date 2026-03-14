import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getBearerToken } from "../_shared/auth.ts";
import { enforceAiEndpointProtection } from "../_shared/aiProtection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PolishRequest {
  surveyText: string;
  surveyId: string;
  forceRepolish?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
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
      "polish-survey-report",
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
    const { surveyText, surveyId, forceRepolish = false }: PolishRequest = await req.json();

    if (!surveyText || !surveyId) {
      return new Response(
        JSON.stringify({ error: "surveyText and surveyId are required" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: "You are an expert report editor. Please rewrite the following survey text as a professional recommendation report.\n- Keep all facts exactly as written.\n- Use clear, concise, client-ready language.\n- Maintain the same meaning as the original text.\n- Output in a structured format with headings if appropriate."
          },
          {
            role: "user",
            content: `Survey text:\n${surveyText}`
          }
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error("OpenAI API error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to polish report with AI" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const openaiData = await openaiResponse.json();
    const polishedText = openaiData.choices[0]?.message?.content;

    if (!polishedText) {
      return new Response(
        JSON.stringify({ error: "No polished text returned from AI" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        polishedText,
        surveyId,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in polish-survey-report:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});