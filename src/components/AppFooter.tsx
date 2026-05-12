import LegalLinks from './legal/LegalLinks';
import { PUBLIC_LEGAL_DETAILS } from '../config/support';

export default function AppFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} EziRisk</p>
          <p className="text-xs text-slate-500">{PUBLIC_LEGAL_DETAILS.footerStatement}</p>
        </div>
        <LegalLinks
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
          itemClassName="text-xs text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline"
        />
      </div>
    </footer>
  );
}
