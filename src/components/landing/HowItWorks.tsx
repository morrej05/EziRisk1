import { Camera, CheckCircle2, ClipboardList, FileCheck2, ListChecks } from 'lucide-react';
import { useFadeInOnScroll } from '../../hooks/useFadeInOnScroll';

const steps = [
  {
    number: '01',
    icon: ClipboardList,
    title: 'Assess site',
    description: 'Work through structured FRA or DSEAR sections so observations are captured consistently while you are on the job.',
  },
  {
    number: '02',
    icon: Camera,
    title: 'Capture evidence',
    description: 'Attach photos and supporting documents directly to the finding, control or assessment context they belong to.',
  },
  {
    number: '03',
    icon: ListChecks,
    title: 'Create recommendations',
    description: 'Turn findings into clear recommendations and keep the action trail connected to the assessment record.',
  },
  {
    number: '04',
    icon: CheckCircle2,
    title: 'Validate readiness',
    description: 'Review completeness and issue checks before the report leaves draft status, reducing last-minute gaps.',
  },
  {
    number: '05',
    icon: FileCheck2,
    title: 'Issue report',
    description: 'Deliver a governed professional report with evidence, findings and recommendations kept in one workflow.',
  },
];

export default function HowItWorks() {
  const { ref, isVisible } = useFadeInOnScroll();

  return (
    <section
      id="how-it-works"
      ref={ref}
      className={`py-20 bg-white transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-3xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
            One governed assessment workflow
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            From site walk to issued report
          </h2>
          <p className="text-xl text-neutral-600">
            Replace disconnected notes, photos and action trackers with a practical assessment journey that keeps context intact.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="relative">
                <div className="h-full rounded-xl border border-neutral-200 bg-neutral-50 p-5 transition-all hover:border-primary-300 hover:shadow-md">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-primary-700">{step.number}</span>
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-600">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  <h3 className="mb-3 text-lg font-semibold text-neutral-900">{step.title}</h3>
                  <p className="text-sm leading-6 text-neutral-600">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute left-[calc(100%-0.5rem)] top-1/2 z-10 h-0.5 w-4 bg-primary-200"></div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
