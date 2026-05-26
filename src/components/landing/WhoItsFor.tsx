import { Building2, Flame, Shield } from 'lucide-react';
import { useFadeInOnScroll } from '../../hooks/useFadeInOnScroll';

const personas = [
  {
    icon: Flame,
    title: 'Independent fire risk assessors',
    description: 'Complete FRA work with observations, evidence and issue controls in one place.',
    benefits: ['FRA-first assessment flow', 'Evidence linked to findings', 'Professional report delivery'],
  },
  {
    icon: Shield,
    title: 'Fire consultancies',
    description: 'Give assessors a consistent route from site notes to reviewed report.',
    benefits: ['Consistent report structure', 'Review-ready recommendations', 'Reusable assessment approach'],
  },
  {
    icon: Building2,
    title: 'Multi-site and insurer workflows',
    description: 'Use a governed record for broader property and operational risk reviews.',
    benefits: ['Portfolio context', 'Operational risk reviews', 'Issue-ready reporting'],
  },
];

export default function WhoItsFor() {
  const { ref, isVisible } = useFadeInOnScroll();

  return (
    <section
      id="who-its-for"
      ref={ref}
      className={`py-28 bg-neutral-50 transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
            Consultant-first
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            For consultants who need controlled reporting
          </h2>
          <p className="text-xl text-neutral-600">
            Complete assessments with full evidence context and issue reports clients can rely on.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {personas.map((persona) => {
            const Icon = persona.icon;
            return (
              <div
                key={persona.title}
                className="bg-white p-8 rounded-xl border border-neutral-200 hover:border-primary-300 hover:shadow-lg transition-all"
              >
                <div className="w-14 h-14 bg-primary-600 rounded-xl flex items-center justify-center mb-6">
                  <Icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-2xl font-semibold text-neutral-900 mb-4">
                  {persona.title}
                </h3>
                <p className="text-neutral-600 leading-relaxed mb-6">
                  {persona.description}
                </p>
                <div className="space-y-2">
                  {persona.benefits.map((benefit) => (
                    <div key={benefit} className="flex items-center gap-2 text-sm text-neutral-700">
                      <div className="w-1.5 h-1.5 bg-success-500 rounded-full"></div>
                      <span>{benefit}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
