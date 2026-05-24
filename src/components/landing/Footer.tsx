import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Shield } from 'lucide-react';
import LegalLinks from '../legal/LegalLinks';
import { PUBLIC_LEGAL_DETAILS } from '../../config/support';

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid md:grid-cols-4 gap-6">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              {!logoError ? (
                <img
                  src="/ezirisk-logo-primary.svg"
                  alt="EziRisk"
                  className="h-5 w-auto object-contain"
                  loading="lazy"
                  onError={() => setLogoError(true)}
                />
              ) : (
                <>
                  <Shield className="w-5 h-5 text-primary-400" />
                  <span className="text-lg font-bold text-white">EziRisk</span>
                </>
              )}
            </div>
            <p className="text-sm text-neutral-400 mb-3 max-w-md leading-relaxed">
              Assessment workflows for fire risk assessors and consultants. Keep evidence, recommendations, readiness checks and professional report issue connected.
            </p>
            <p className="text-xs text-neutral-500 max-w-md leading-relaxed">
              {PUBLIC_LEGAL_DETAILS.footerStatement}
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
                  to="/pricing"
                  className="text-neutral-400 hover:text-white transition-colors"
                >
                  Pricing
                </Link>
              </li>
              <li>
                <Link
                  to="/security"
                  className="text-neutral-400 hover:text-white transition-colors"
                >
                  Security
                </Link>
              </li>
              <li>
                <Link
                  to="/contact"
                  className="text-neutral-400 hover:text-white transition-colors"
                >
                  Contact
                </Link>
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

        <div className="mt-8 pt-6 border-t border-neutral-800">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-neutral-500">
              © {new Date().getFullYear()} EziRisk. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
