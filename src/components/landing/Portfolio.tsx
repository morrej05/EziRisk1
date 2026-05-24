import { BarChart3, FileCheck, TrendingUp } from 'lucide-react';
import { useFadeInOnScroll } from '../../hooks/useFadeInOnScroll';

const portfolioFeatures = [
  {
    icon: BarChart3,
    title: 'See recurring findings across sites',
  },
  {
    icon: TrendingUp,
    title: 'Spot repeated recommendation themes',
  },
  {
    icon: FileCheck,
    title: 'Report across clients without losing detail',
  },
];

export default function Portfolio() {
  const { ref, isVisible } = useFadeInOnScroll();

  return (
    <section
      ref={ref}
      className={`py-28 bg-neutral-50 transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
            When one client becomes many sites
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            Portfolio context when clients scale
          </h2>
          <p className="text-xl text-neutral-600">
            Review patterns across locations after the assessment work is complete.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {portfolioFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="bg-white p-8 rounded-xl border border-neutral-200 hover:border-primary-300 hover:shadow-md transition-all"
              >
                <div className="w-12 h-12 bg-primary-600 rounded-lg flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <p className="text-neutral-900 text-lg leading-relaxed">
                  {feature.title}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
