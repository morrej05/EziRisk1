import { Link } from 'react-router-dom';

const PRODUCTS = [
  'Fire Risk Assessments',
  'Fire Strategy Documents',
  'DSEAR',
  'Risk Engineering',
];

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-[#040814] via-[#0A1630] to-[#13264A]">
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-transparent"></div>
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-20"></div>

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-blue-200">
          For fire risk assessors and consultants
        </p>

        <h1 className="mb-6 max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl md:text-6xl">
          Finish professional fire assessment reports in one structured workflow.
        </h1>

        <p className="mb-5 max-w-xl text-lg leading-8 text-blue-100">
          Capture findings, link evidence and create traceable recommendations — then issue professional reports with readiness checks and evidence context intact.
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
            Start an assessment
          </Link>
          <p className="text-sm text-neutral-300">Free for 14 days. Upgrade to Standard or Professional anytime.</p>
        </div>
      </div>
    </section>
  );
}
