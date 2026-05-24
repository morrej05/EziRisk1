import { ReactNode } from 'react';
import PrimaryNavigation from './PrimaryNavigation';
import BillingStatusBanner from './BillingStatusBanner';
import TrialStatusBanner from './TrialStatusBanner';
import AppFooter from './AppFooter';

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PrimaryNavigation />
      <BillingStatusBanner />
      <TrialStatusBanner />
      <div className="flex-1">{children}</div>
      <AppFooter />
    </div>
  );
}
