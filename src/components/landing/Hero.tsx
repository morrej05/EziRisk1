import { Link } from 'react-router-dom';

export default function Hero() {
  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden">
      <img
        src="/hero-risk.webp"
        alt="Industrial risk engineering site inspection"
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div className="absolute inset-0 bg-gradient-to-r from-blue-950/90 via-blue-950/70 to-transparent"></div>
      <div className="scan-line" aria-hidden="true"></div>

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <p className="mb-4 text-sm text-blue-200">Built for risk engineers. Trusted by professionals.</p>

        <h1 className="mb-6 text-5xl font-bold leading-tight text-white md:text-6xl">
          Professional risk assessments and reports, made simpler
        </h1>

        <p className="mb-8 max-w-xl text-lg text-blue-100">
          Create FRA, FSD, DSEAR / ATEX and risk engineering reports with structured workflows,
          consistent insurer-grade outputs, and AI-assisted portfolio analysis.
        </p>

        <div className="flex flex-col items-start gap-3">
          <Link
            to="/signin"
            className="rounded-lg bg-white px-6 py-3 font-semibold text-blue-900 transition hover:bg-gray-100"
          >
            Start free trial →
          </Link>

          <p className="mt-1 text-sm text-blue-200">Free for 14 days. Upgrade anytime.</p>
        </div>
      </div>
    </section>
  );
}
