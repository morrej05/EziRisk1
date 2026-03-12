import { useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import { buildReSurveyPdf } from '../../lib/pdf/buildReSurveyPdf';
import { createCanonicalReSurveyFixture } from '../../lib/pdf/fixtures/reSurveyCanonicalFixture';

export default function ReSurveyPdfFixturePage() {
  const fixture = useMemo(() => createCanonicalReSurveyFixture(), []);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const pdfBytes = await buildReSurveyPdf(fixture.options);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const nextUrl = URL.createObjectURL(blob);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to generate canonical RE Survey fixture PDF';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const handleDownload = async () => {
    if (!pdfUrl) return;
    const res = await fetch(pdfUrl);
    const blob = await res.blob();
    saveAs(blob, fixture.filename);
  };

  return (
    <div className="min-h-screen bg-neutral-50 p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <h1 className="text-2xl font-semibold text-neutral-900">Canonical RE Survey PDF Fixture (Dev-only)</h1>
        <p className="text-sm text-neutral-700">
          This page renders a deterministic RE Survey PDF from a local fixture payload only. It does not call Supabase and is intended for visual QA.
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={isGenerating}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isGenerating ? 'Generating…' : 'Regenerate Fixture PDF'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!pdfUrl || isGenerating}
            className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 disabled:opacity-50"
          >
            Download PDF
          </button>
        </div>

        {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {pdfUrl && (
          <iframe
            title="Canonical RE Survey PDF Fixture"
            src={pdfUrl}
            className="h-[82vh] w-full rounded border border-neutral-300 bg-white"
          />
        )}
      </div>
    </div>
  );
}
