import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getDefaultRegion, getPricing } from '../../config/pricing';
import { PUBLIC_LEGAL_DETAILS } from '../../config/support';

const region = getDefaultRegion();

const plans = [
  {
    title: 'Free Trial',
    price: 'Free',
    details: ['14-day trial', '1 user', 'Up to 5 reports'],
    cta: 'Start free trial',
    recommended: false,
  },
  {
    title: 'Standard',
    price: `£${getPricing(region, 'standard', 'monthly')} / month`,
    annualPrice: `or £${getPricing(region, 'standard', 'annual')} / year`,
    details: ['For individual consultants', 'Up to 2 users', 'Up to 10 reports'],
    cta: 'Upgrade to Standard',
    recommended: false,
  },
  {
    title: 'Professional',
    price: `£${getPricing(region, 'professional', 'monthly')} / month`,
    annualPrice: `or £${getPricing(region, 'professional', 'annual')} / year`,
    details: ['For teams and consultancies', 'Up to 5 users', 'Up to 30 reports'],
    cta: 'Upgrade to Professional',
    recommended: true,
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 bg-neutral-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">Simple, transparent pricing</h2>
          <p className="text-xl text-neutral-600 max-w-3xl mx-auto">
            Start with structured assessment reporting. Upgrade when your reporting volume grows.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {plans.map((plan) => (
            <div
              key={plan.title}
              className={`relative p-6 bg-white rounded-xl border transition-shadow ${
                plan.recommended
                  ? 'border-primary-400 shadow-md ring-1 ring-primary-300'
                  : 'border-neutral-200'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-primary-200 bg-primary-50 px-3 py-0.5 text-xs font-semibold text-primary-700">
                  Recommended
                </span>
              )}
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
          All plans include access to FRA workflows, DSEAR / ATEX assessments and broader risk engineering reports.
        </p>
        <p className="mt-3 text-center text-sm text-neutral-500">
          {PUBLIC_LEGAL_DETAILS.footerStatement}
        </p>

        <div className="mt-10 mx-auto max-w-xl rounded-xl border border-neutral-200 bg-white p-6 text-center">
          <p className="font-semibold text-neutral-900 mb-1">
            Need more users, multi-site deployment or a custom setup?
          </p>
          <p className="text-sm text-neutral-500 mb-4">
            Enterprise plans are available for insurers, consultancies and multi-site organisations.
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-800 transition-colors"
          >
            Get in touch <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
