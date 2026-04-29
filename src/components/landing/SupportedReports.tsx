import { Flame, Building2, AlertTriangle, Shield } from 'lucide-react';

const reportTypes = [
  {
    icon: Flame,
    title: 'FRA (Fire Risk Assessment)',
    description: 'Assessment of fire risk within a building, covering occupancy, protection systems, and compliance.',
  },
  {
    icon: Building2,
    title: 'FSD (Fire Strategy Document)',
    description: 'Preparation and review of fire strategy documents for new and existing buildings.',
  },
  {
    icon: AlertTriangle,
    title: 'DSEAR / ATEX',
    description: 'Assessment of risks from explosive atmospheres and hazardous substances.',
  },
  {
    icon: Shield,
    title: 'Risk Engineering (Insurer-grade)',
    description: 'Structured, insurer-grade risk assessments covering property, operations, and protection systems.',
  },
];

export default function SupportedReports() {
  return (
    <section className="max-w-7xl mx-auto px-6 py-16">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <img
            src="/images/portfolio-dashboard.png"
            alt="EziRisk platform preview"
            className="w-full rounded-xl shadow-lg"
          />
        </div>

        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">
            Supported report types
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {reportTypes.map((report, index) => {
              const Icon = report.icon;
              return (
                <div
                  key={index}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="w-12 h-12 bg-primary-600 rounded-lg flex items-center justify-center mb-3">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
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
