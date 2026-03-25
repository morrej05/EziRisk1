import { Flame, Building2, AlertTriangle, Shield } from 'lucide-react';

const reportTypes = [
  {
    icon: Flame,
    title: 'FRA (Fire Risk Assessment)',
    description: 'Assessment of fire risk within a building, covering occupancy, protection systems, and compliance.',
  },
  {
    icon: Building2,
    title: 'FSD (Fire Safety Design)',
    description: 'Evaluation of fire strategy and design measures in new or modified buildings.',
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
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            Supported report types
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {reportTypes.map((report, index) => {
            const Icon = report.icon;
            return (
              <div
                key={index}
                className="p-6 bg-white rounded-xl border border-neutral-200 hover:border-primary-300 hover:shadow-lg transition-all"
              >
                <div className="w-12 h-12 bg-primary-600 rounded-lg flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-neutral-900 mb-3">
                  {report.title}
                </h3>
                <p className="text-neutral-600 leading-relaxed">
                  {report.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
