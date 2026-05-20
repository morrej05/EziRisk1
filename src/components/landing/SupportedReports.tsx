import { AlertTriangle, Building2, FileText, Flame } from 'lucide-react';

const reportTypes = [
  {
    icon: Flame,
    title: 'Fire Risk Assessments (FRA)',
    description: 'Structured FRA delivery for findings, evidence, recommendations and report issue.',
  },
  {
    icon: FileText,
    title: 'Fire Strategy Documents (FSD)',
    description: 'Structured fire strategy reporting for compartmentation, fire protection planning and review issue.',
  },
  {
    icon: AlertTriangle,
    title: 'DSEAR / explosive atmosphere assessments',
    description: 'Capture hazardous substance observations, controls and evidence in a professional assessment record.',
  },
  {
    icon: Building2,
    title: 'Insurer-style risk engineering reviews',
    description: 'Support property and operational risk reviews using the same evidence, recommendations and reporting approach.',
  },
];

export default function SupportedReports() {
  return (
    <section className="max-w-7xl mx-auto px-6 py-20">
      <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:items-center">
        <div>
          <img
            src="/images/portfolio-dashboard.png"
            alt="EziRisk assessment workflow preview"
            className="w-full rounded-xl shadow-lg"
          />
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
            Four core assessment workflows
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Built around professional assessment delivery
          </h2>
          <p className="mb-7 max-w-2xl text-lg leading-8 text-slate-600">
            FRA-first, with clear paths for FSD, DSEAR and risk engineering review work.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {reportTypes.map((report) => {
              const Icon = report.icon;
              return (
                <div
                  key={report.title}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-primary-300 hover:shadow-md"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600">
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold leading-snug text-slate-900">
                    {report.title}
                  </h3>
                  <p className="text-sm leading-6 text-slate-600">
                    {report.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
