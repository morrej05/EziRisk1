import { Link } from 'react-router-dom';

const PRODUCTS = [
  'Fire Risk Assessments',
  'Fire Strategy Documents',
  'DSEAR',
  'Risk Engineering',
];

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
          For fire risk assessors, consultants and risk engineers
        </p>

        <h1 className="mb-6 max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl md:text-6xl">
          From site walk to issued report — structured, traceable and defensible.
        </h1>

        <p className="mb-5 max-w-xl text-lg leading-8 text-blue-100">
          Structure findings, link evidence and produce traceable recommendations — then issue defensible reports with readiness checks and a full audit trail built in.
        </p>

        <div className="mb-7 flex flex-wrap gap-2">
          {PRODUCTS.map((product) => (
            <span
              key={product}
              className="inline-flex items-center rounded border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium text-blue-100"
            >
              {product}
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            to="/signin"
            className="inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 font-semibold text-blue-900 transition hover:bg-gray-100"
          >
            Start free trial
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center justify-center rounded-lg border border-white/40 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
}
