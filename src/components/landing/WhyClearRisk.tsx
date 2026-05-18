import { CheckCircle2, FileText, Link2, ShieldCheck } from 'lucide-react';
import { useFadeInOnScroll } from '../../hooks/useFadeInOnScroll';

const benefits = [
  {
    icon: Link2,
    title: 'Evidence stays in context',
    description: 'Photos and documents stay linked to the relevant finding or control.',
  },
  {
    icon: CheckCircle2,
    title: 'Recommendations stay traceable',
    description: 'Actions remain connected through review, reporting and issue.',
  },
  {
    icon: FileText,
    title: 'Reports follow a consistent structure',
    description: 'Governed templates reduce missing context and ad hoc assembly.',
  },
  {
    icon: ShieldCheck,
    title: 'Issue controls support professionalism',
    description: 'Readiness checks help resolve gaps before client delivery.',
  },
];

export default function WhyClearRisk() {
  const { ref, isVisible } = useFadeInOnScroll();

  return (
    <section
      ref={ref}
      className={`py-28 bg-neutral-900 text-white transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-200">
            Calm, controlled report issue
          </p>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Professional delivery without the admin sprawl
          </h2>
          <p className="text-xl text-neutral-300">
            Practical controls for the space between site work and client-ready report.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {benefits.map((benefit) => {
            const Icon = benefit.icon;
            return (
              <div
                key={benefit.title}
                className="bg-neutral-800/50 p-8 rounded-xl border border-neutral-700 hover:border-neutral-600 transition-all"
              >
                <div className="flex items-start gap-6">
                  <div className="w-12 h-12 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-2">
                      {benefit.title}
                    </h3>
                    <p className="text-neutral-300 leading-relaxed">
                      {benefit.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-16 rounded-xl border border-neutral-700 bg-neutral-800/50 p-8 text-center">
          <p className="mx-auto max-w-3xl text-lg text-neutral-300">
            Replace scattered files with a governed assessment record that is easier to review, issue and repeat.
          </p>
        </div>
      </div>
    </section>
  );
}
