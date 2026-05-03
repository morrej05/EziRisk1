import { useEffect } from 'react';
import LandingPage from './LandingPage';

export default function PricingPage() {
  useEffect(() => {
    const el = document.getElementById('pricing');
    if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, []);

  return <LandingPage />;
}
