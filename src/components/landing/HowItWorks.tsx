import { Camera, CheckCircle2, ClipboardList, FileCheck2, ListChecks } from 'lucide-react';
import { useFadeInOnScroll } from '../../hooks/useFadeInOnScroll';

const steps = [
  {
    number: '01',
    icon: ClipboardList,
    title: 'Assess site',
    description: 'Complete structured sections on site — premises, hazards, persons at risk and existing controls.',
  },
  {
    number: '02',
    icon: Camera,
    title: 'Capture evidence',
    description: 'Attach photos and documents directly to the finding or control they relate to.',
  },
  {
    number: '03',
    icon: ListChecks,
    title: 'Create recommendations',
    description: 'Convert findings into prioritised, traceable recommendations linked to the assessment record.',
  },
  {
    number: '04',
    icon: CheckCircle2,
    title: 'Validate readiness',
    description: 'Run completeness checks across sections, evidence and recommendations before issue.',
  },
  {
    number: '05',
    icon: FileCheck2,
    title: 'Issue report',
    description: 'Lock and issue a version-controlled report — with findings, evidence and recommendations intact.',
  },
];

export default function HowItWorks() {
  const { ref, isVisible } = useFadeInOnScroll();

  return (
    <section
      id="how-it-works"
      ref={ref}
      className={`py-24 bg-white transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
            One end-to-end assessment workflow
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            From site walk to issued report
          </h2>
          <p className="text-xl text-neutral-600">
            Keep notes, photos and actions connected through each stage of delivery.
          </p>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="relative">
                <div className="h-full rounded-xl border border-neutral-200 bg-neutral-50 p-5 transition-all hover:border-primary-300 hover:shadow-md">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 ring-1 ring-primary-200">
                      {step.number}
                    </span>
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-600">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  <h3 className="mb-3 text-lg font-semibold text-neutral-900">{step.title}</h3>
                  <p className="text-sm leading-6 text-neutral-600">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute left-full top-1/2 z-10 h-px w-4 -translate-y-px bg-primary-300"></div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
