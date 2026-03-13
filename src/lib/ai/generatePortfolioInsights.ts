export interface PortfolioAiPayload {
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
