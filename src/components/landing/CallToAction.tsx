import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function CallToAction() {
  return (
    <section className="py-28 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
          Ready to issue cleaner reports?
        </p>
        <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-6">
          Start with a structured path from assessment to issued report.
        </h2>
        <p className="text-xl text-neutral-600 mb-10 max-w-2xl mx-auto">
          Keep findings, evidence and recommendations connected until the report is ready to issue.
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href="#how-it-works"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-primary-200 text-primary-800 rounded-lg font-semibold text-lg hover:bg-primary-50 transition-colors"
          >
            View assessment workflow
          </a>
          <Link
            to="/signin"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary-600 text-white rounded-lg font-semibold text-lg hover:bg-primary-700 transition-colors shadow-lg"
          >
            Start an assessment
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
        <p className="mt-6 text-sm text-neutral-500">
          Start with a free account. Upgrade when your reporting volume grows.
        </p>
      </div>
    </section>
  );
}
