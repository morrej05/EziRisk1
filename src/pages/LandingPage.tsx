import Navbar from '../components/landing/Navbar';
import Hero from '../components/landing/Hero';
import HeroScreenshot from '../components/landing/HeroScreenshot';
import TrustStrip from '../components/landing/TrustStrip';
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
      <HeroScreenshot />
      <TrustStrip />
      <HowItWorks />
      <SupportedReports />
      <WhatItDoes />
      <WhoItsFor />
      <Portfolio />
      <WhyClearRisk />
      <CallToAction />
      <Pricing />
      <Footer />
    </div>
  );
}
