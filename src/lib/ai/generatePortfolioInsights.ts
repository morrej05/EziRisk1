export interface PortfolioAiPayload {
  summary: {
    totalSites: number;
    totalAssessments: number;
    totalActions: number;
    openP1Actions: number;
    updatedLast30Days: number;
  };
  assessmentStatusDistribution: Array<{
    label: string;
    count: number;
  }>;
  commonActionModules: Array<{
    label: string;
    count: number;
  }>;
  actionProfile: {
    byPriority: Array<{
      label: string;
      count: number;
    }>;
    byStatus: Array<{
      label: string;
      count: number;
    }>;
  };
  sitesRequiringAttention: Array<{
    siteName: string;
    clientName: string;
    openActions: number;
    overdueActions: number;
    p1OpenActions: number;
  }>;
}

export interface PortfolioAiInsights {
  summary: string;
  concentrations: string[];
  priorities: string[];
  draftCommentary: string;
}

interface GeneratePortfolioInsightsResponse {
  success: boolean;
  insights?: PortfolioAiInsights;
  error?: string;
}

export async function generatePortfolioInsights(payload: PortfolioAiPayload): Promise<PortfolioAiInsights> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-portfolio-insights`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ portfolio: payload }),
  });

  const data = (await response.json().catch(() => ({}))) as GeneratePortfolioInsightsResponse;

  if (!response.ok || !data.insights) {
    throw new Error(data.error || 'Failed to generate portfolio insights');
  }

  return data.insights;
}
