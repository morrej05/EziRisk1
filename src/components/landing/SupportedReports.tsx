import { AlertTriangle, Flame, ShieldCheck } from 'lucide-react';

const reportTypes = [
  {
    icon: Flame,
    title: 'Fire Risk Assessments',
    description: 'Structured FRA workflows for findings, evidence, recommendations and professional report issue.',
  },
  {
    icon: AlertTriangle,
    title: 'DSEAR / explosive atmosphere assessments',
    description: 'Capture hazardous substance and explosive atmosphere observations with the same governed evidence trail.',
  },
  {
    icon: ShieldCheck,
    title: 'Risk engineering reviews',
    description: 'Support insurer-style property and operational risk reviews when clients need broader assessment outputs.',
  },
];

export default function SupportedReports() {
  return (
    <section className="max-w-7xl mx-auto px-6 py-16">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <img
            src="/images/portfolio-dashboard.png"
            alt="EziRisk assessment workflow preview"
            className="w-full rounded-xl shadow-lg"
          />
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
            FRA first, extensible when needed
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Built around professional assessment delivery
          </h2>
          <p className="mb-6 text-lg leading-8 text-slate-600">
            EziRisk is strongest where assessors need to finish and issue clear, defensible reports—not just store data.
          </p>
          <div className="grid grid-cols-1 gap-4">
            {reportTypes.map((report) => {
              const Icon = report.icon;
              return (
                <div
                  key={report.title}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-600">
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h3 className="mb-2 text-lg font-semibold text-slate-900">
                        {report.title}
                      </h3>
                      <p className="text-sm leading-6 text-slate-600">
                        {report.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
