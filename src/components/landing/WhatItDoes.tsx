import { useFadeInOnScroll } from '../../hooks/useFadeInOnScroll';

export default function WhatItDoes() {
  const { ref, isVisible } = useFadeInOnScroll();

  return (
    <section
      ref={ref}
      className={`py-24 bg-white transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            What EziRisk Does
          </h2>
          <p className="text-xl text-neutral-600 max-w-3xl mx-auto">
            Complete risk assessment and reporting platform for FRA, FSD, DSEAR / ATEX and risk engineering
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="text-center">
            <img
              src="/what-create.webp"
              alt="Create Assessments"
              className="mb-6 h-44 w-full rounded-xl border border-slate-200 object-cover object-top shadow-sm"
            />
            <h3 className="text-xl font-semibold text-neutral-900 mb-2">
              Create Assessments
            </h3>
            <p className="text-neutral-600">
              Structured forms capture all required data for risk assessments and reports
            </p>
          </div>

          <div className="text-center">
            <img
              src="/what-recommendations.webp"
              alt="Add Recommendations"
              className="mb-6 h-44 w-full rounded-xl border border-slate-200 object-cover object-top shadow-sm"
            />
            <h3 className="text-xl font-semibold text-neutral-900 mb-2">
              Add Recommendations
            </h3>
            <p className="text-neutral-600">
              Use the recommendation library with smart triggers or create custom findings
            </p>
          </div>

          <div className="text-center">
            <img
              src="/what-export.webp"
              alt="Export Reports"
              className="mb-6 h-44 w-full rounded-xl border border-slate-200 object-cover object-top shadow-sm"
            />
            <h3 className="text-xl font-semibold text-neutral-900 mb-2">
              Export Reports
            </h3>
            <p className="text-neutral-600">
              Professional reports combining assessment findings and recommendations, ready for clients
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
