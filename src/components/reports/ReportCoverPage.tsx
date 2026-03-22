import { Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_LOGO } from '../../lib/pdf/pdfUtils';

interface ReportCoverPageProps {
  reportType: 'survey' | 'recommendation';
  clientLogoUrl?: string | null;
  inspectionDate?: string | null;
  siteName?: string | null;
  surveyorName?: string | null;
  clientName?: string | null;
  clientAddress?: string | null;
  isDraft?: boolean;
}

export default function ReportCoverPage({
  reportType,
  clientLogoUrl,
  inspectionDate,
  siteName,
  surveyorName,
  clientName,
  clientAddress,
  isDraft = false,
}: ReportCoverPageProps) {
  const normalizedClientLogoUrl = clientLogoUrl?.trim() || null;
  const hasClientLogo = Boolean(normalizedClientLogoUrl);

  const [logoSrc, setLogoSrc] = useState<string>(
    hasClientLogo ? normalizedClientLogoUrl! : DEFAULT_LOGO,
  );
  const [showTextFallback, setShowTextFallback] = useState(false);
  const isDefaultLogo = logoSrc === DEFAULT_LOGO;

  useEffect(() => {
    setLogoSrc(hasClientLogo ? normalizedClientLogoUrl! : DEFAULT_LOGO);
    setShowTextFallback(false);
  }, [hasClientLogo, normalizedClientLogoUrl]);

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return null;
    try {
      return new Date(dateString).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return null;
    }
  };

  const reportTitle = reportType === 'survey'
    ? 'EziRisk Survey Report'
    : 'EziRisk Recommendation Report';

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-12 bg-white page-break-after">
      {isDraft && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
          <div
            className="text-[12rem] font-bold text-gray-200 transform -rotate-45 select-none opacity-30"
            style={{
              letterSpacing: '0.2em',
              lineHeight: '1',
            }}
          >
            DRAFT
          </div>
        </div>
      )}

      <div className="relative z-10 text-center max-w-2xl space-y-12">
        <div className="flex justify-center mb-8">
          {!showTextFallback ? (
            <div className="w-80 h-24 flex items-center justify-center">
              <img
                src={isDefaultLogo ? '/ezirisk-logo-primary.svg' : logoSrc}
                alt={isDefaultLogo ? 'EziRisk Logo' : 'Client Logo'}
                width={320}
                height={96}
                className="block w-full h-full object-contain"
                onError={() => {
                  if (!isDefaultLogo) {
                    setLogoSrc(DEFAULT_LOGO);
                    return;
                  }
                  setShowTextFallback(true);
                }}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Shield className="w-16 h-16 text-primary-600" />
              <span className="text-4xl font-bold text-neutral-900">EziRisk</span>
            </div>
          )}
        </div>

        <div>
          <h1 className="text-5xl font-bold text-neutral-900 mb-4">
            {reportTitle}
          </h1>
        </div>

        <div className="space-y-6 text-left bg-neutral-50 border-2 border-neutral-200 rounded-lg p-8">
          {clientName && (
            <div>
              <div className="text-sm font-semibold text-neutral-600 uppercase tracking-wide mb-1">
                Client
              </div>
              <div className="text-lg text-neutral-900 font-medium">
                {clientName}
              </div>
            </div>
          )}

          {clientAddress && (
            <div>
              <div className="text-sm font-semibold text-neutral-600 uppercase tracking-wide mb-1">
                Address
              </div>
              <div className="text-lg text-neutral-900 whitespace-pre-line">
                {clientAddress}
              </div>
            </div>
          )}

          {siteName && (
            <div>
              <div className="text-sm font-semibold text-neutral-600 uppercase tracking-wide mb-1">
                Site
              </div>
              <div className="text-lg text-neutral-900 font-medium">
                {siteName}
              </div>
            </div>
          )}

          {inspectionDate && (
            <div>
              <div className="text-sm font-semibold text-neutral-600 uppercase tracking-wide mb-1">
                Inspection Date
              </div>
              <div className="text-lg text-neutral-900">
                {formatDate(inspectionDate)}
              </div>
            </div>
          )}

          {surveyorName && (
            <div>
              <div className="text-sm font-semibold text-neutral-600 uppercase tracking-wide mb-1">
                Surveyor
              </div>
              <div className="text-lg text-neutral-900">
                {surveyorName}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .page-break-after {
          page-break-after: always;
          break-after: page;
        }
      `}</style>
    </div>
  );
}
