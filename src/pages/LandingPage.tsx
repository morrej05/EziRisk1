import Navbar from '../components/landing/Navbar';
import Hero from '../components/landing/Hero';
import SupportedReports from '../components/landing/SupportedReports';
import WhatItDoes from '../components/landing/WhatItDoes';
import HowItWorks from '../components/landing/HowItWorks';
import WhoItsFor from '../components/landing/WhoItsFor';
import Portfolio from '../components/landing/Portfolio';
import WhyClearRisk from '../components/landing/WhyClearRisk';
import CallToAction from '../components/landing/CallToAction';
import Pricing from '../components/landing/Pricing';
import Footer from '../components/landing/Footer';

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="space-y-8 text-center">
            <div className="space-y-6">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                See the platform in action
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-slate-600">
                From structured assessments to portfolio-level insight and reporting.
              </p>
            </div>
            <img
              src="/images/portfolio-dashboard.png"
              alt="EziRisk portfolio analysis dashboard showing risk metrics and trends"
              className="w-full max-w-5xl mx-auto rounded-xl shadow-lg"
            />
          </div>
        </div>
      </section>
      <SupportedReports />
      <WhatItDoes />
      <HowItWorks />
      <WhoItsFor />
      <Portfolio />
      <WhyClearRisk />
      <CallToAction />
      <Pricing />
      <Footer />
    </div>
  );
}
