import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-[#0B1F2A] to-[#12394D]">
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-transparent"></div>
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-20"></div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32 text-center">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
          Professional risk assessments and reports, made simpler
        </h1>

        <p className="text-xl md:text-2xl text-neutral-200 mb-12 max-w-3xl mx-auto leading-relaxed">
          Create FRA, FSD, DSEAR / ATEX and risk engineering reports with structured workflows,
          consistent insurer-grade outputs, AI-assisted recommendations, and portfolio analysis.
        </p>

        <div className="flex flex-col gap-3 justify-center items-center">
          <Link
            to="/signin"
            className="group px-8 py-4 bg-white text-primary-700 rounded-lg font-semibold text-lg hover:bg-neutral-50 transition-all hover:scale-105 flex items-center gap-2 shadow-xl"
          >
            Start free trial
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <p className="text-sm text-neutral-300">Free for 14 days. Upgrade to Standard or Professional anytime.</p>
        </div>
      </div>
    </section>
  );
}
