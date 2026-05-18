import { Link } from 'react-router-dom';

export default function Hero() {
  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden">
      <img
        src="/hero-risk.webp"
        alt="Fire risk assessor completing a site inspection"
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div className="absolute inset-0 bg-gradient-to-r from-blue-950/95 via-blue-950/78 to-blue-950/20"></div>
      <div className="scan-line" aria-hidden="true"></div>

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-blue-200">
          For fire risk assessors and consultants
        </p>

        <h1 className="mb-6 max-w-4xl text-4xl font-bold leading-tight text-white sm:text-5xl md:text-6xl">
          Finish fire risk assessment reports without juggling Word documents, photo folders and spreadsheets.
        </h1>

        <p className="mb-8 max-w-2xl text-lg leading-8 text-blue-100">
          EziRisk gives consultants a structured workflow for FRA and DSEAR assessments: capture findings,
          link evidence, create recommendations, check issue readiness and produce governed professional reports.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href="#how-it-works"
            className="inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 font-semibold text-blue-900 transition hover:bg-gray-100"
          >
            See the assessment workflow →
          </a>
          <Link
            to="/signin"
            className="inline-flex items-center justify-center rounded-lg border border-white/40 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Start an assessment
          </Link>
        </div>

        <p className="mt-4 max-w-xl text-sm text-blue-200">
          Built to keep assessment notes, evidence, recommendations and report issue controls connected from site walk to issued report.
        </p>
      </div>
    </section>
  );
}
