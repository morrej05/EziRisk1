import { Link } from 'react-router-dom';
import { getDefaultRegion, getPricing } from '../../config/pricing';

const region = getDefaultRegion();

const plans = [
  {
    title: 'Free Trial',
    price: 'Free',
    details: ['14-day trial', '1 user', 'Up to 5 reports'],
    cta: 'Start free trial',
  },
  {
    title: 'Standard',
    price: `£${getPricing(region, 'standard', 'monthly')} / month`,
    annualPrice: `or £${getPricing(region, 'standard', 'annual')} / year`,
    details: ['For individual consultants', 'Up to 2 users', 'Up to 10 reports'],
    cta: 'Upgrade to Standard',
  },
  {
    title: 'Professional',
    price: `£${getPricing(region, 'professional', 'monthly')} / month`,
    annualPrice: `or £${getPricing(region, 'professional', 'annual')} / year`,
    details: ['For teams and consultancies', 'Up to 5 users', 'Up to 30 reports'],
    cta: 'Upgrade to Professional',
  },
];

export default function Pricing() {
  return (
    <section className="py-24 bg-neutral-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">Simple, transparent pricing</h2>
          <p className="text-xl text-neutral-600 max-w-3xl mx-auto">
            Start with a free trial. Upgrade when you need more.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div key={plan.title} className="p-6 bg-white rounded-xl border border-neutral-200">
              <h3 className="text-xl font-semibold text-neutral-900">{plan.title}</h3>
              <p className="text-3xl font-bold text-neutral-900 mt-3">{plan.price}</p>
              {plan.annualPrice && <p className="mt-1 text-sm text-neutral-500">{plan.annualPrice}</p>}
              <ul className="mt-5 space-y-2 text-neutral-600">
                {plan.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              <Link
                to="/signin"
                className="inline-flex items-center justify-center mt-6 w-full px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-neutral-500">No long-term contracts. Upgrade or cancel anytime.</p>
        <p className="mt-1 text-center text-sm text-neutral-500">
          All plans include access to FRA, FSD, DSEAR / ATEX and risk engineering reports.
        </p>
      </div>
    </section>
  );
}
