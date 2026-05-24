import { useFadeInOnScroll } from '../../hooks/useFadeInOnScroll';

const workflowFriction = [
  {
    image: '/what-create.webp',
    alt: 'Structured assessment form',
    title: 'Replace blank-document reporting',
    description: 'Start from structured assessment sections instead of a blank report file.',
  },
  {
    image: '/what-recommendations.webp',
    alt: 'Recommendations linked to assessment findings',
    title: 'Keep recommendations connected',
    description: 'Link findings, actions and evidence back to the assessment context.',
  },
  {
    image: '/what-export.webp',
    alt: 'Professional report output',
    title: 'Issue with more control',
    description: 'Resolve draft gaps before the assessment is issued.',
  },
];

export default function WhatItDoes() {
  const { ref, isVisible } = useFadeInOnScroll();

  return (
    <section
      ref={ref}
      className={`py-28 bg-white transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
            Built for fire risk assessors
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            Replace disconnected report assembly
          </h2>
          <p className="text-xl text-neutral-600">
            Bring notes, photos and actions into the same reporting path.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {workflowFriction.map((item) => (
            <div key={item.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <img
                src={item.image}
                alt={item.alt}
                className="mb-6 h-44 w-full rounded-xl border border-slate-200 object-cover object-top shadow-sm"
              />
              <h3 className="mb-3 text-xl font-semibold text-neutral-900">
                {item.title}
              </h3>
              <p className="leading-7 text-neutral-600">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
