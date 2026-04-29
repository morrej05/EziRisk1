import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Shield } from 'lucide-react';
import LegalLinks from '../legal/LegalLinks';

export default function Footer() {
  const [logoError, setLogoError] = useState(false);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <footer className="text-neutral-300" style={{ background: 'linear-gradient(180deg, #0E3E5A 0%, #0B2F45 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              {!logoError ? (
                <div className="flex items-center shrink-0 px-2 py-1 rounded" style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}>
                  <img
                    src="/ezirisk-logo-primary.svg"
                    alt="EziRisk"
                    className="h-6 w-auto object-contain"
                    loading="lazy"
                    onError={() => setLogoError(true)}
                  />
                </div>
              ) : (
                <>
                  <Shield className="w-6 h-6 text-primary-400" />
                  <h3 className="text-2xl font-bold text-white">EziRisk</h3>
                </>
              )}
            </div>
            <p className="text-neutral-300 mb-4 max-w-md leading-relaxed">
              Professional risk assessment and reporting platform for engineering and assessment consultants. Structured workflows, consistent outputs, and insurer-grade reporting.
            </p>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Navigation</h4>
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => scrollToSection('how-it-works')}
                  className="text-neutral-400 hover:text-white transition-colors"
                >
                  How it works
                </button>
              </li>
              <li>
                <button
                  onClick={() => scrollToSection('who-its-for')}
                  className="text-neutral-400 hover:text-white transition-colors"
                >
                  Who it's for
                </button>
              </li>
              <li>
                <Link
                  to="/signin"
                  className="text-neutral-400 hover:text-white transition-colors"
                >
                  Sign in
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Legal</h4>
            <LegalLinks className="space-y-2" />
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-neutral-800">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-neutral-500">
              © {new Date().getFullYear()} EziRisk. All rights reserved.
            </p>
            <p className="text-sm text-neutral-500">
              Reports should be reviewed by qualified professionals before use.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
