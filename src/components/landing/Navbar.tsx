import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: "Who it's for", href: '#who-its-for' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Security', href: '/security' },
];

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeMenu = () => setIsMenuOpen(false);

  const solidHeader = isScrolled || isMenuOpen;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${
        solidHeader ? 'bg-white border-b border-gray-200' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className={`transition-all duration-300 ${solidHeader ? '' : 'bg-white/85 rounded-md px-2 py-1 shadow-sm'}`}>
          <img
            src="/ezirisk-logo-primary.svg"
            alt="EziRisk"
            className={`h-9 w-auto transition-all duration-300 ${
              solidHeader ? '' : 'drop-shadow-[0_1px_8px_rgba(255,255,255,0.45)]'
            }`}
          />
        </div>

        {/* Desktop nav */}
        <nav className={`hidden md:flex items-center gap-8 transition-colors ${isScrolled ? 'text-slate-700' : 'text-white/90'}`}>
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`transition ${isScrolled ? 'hover:text-slate-900' : 'hover:text-white'}`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* Desktop CTA */}
          <a
            href="/signin"
            className={`hidden md:inline-flex px-4 py-2 rounded-lg font-medium transition ${
              isScrolled ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-white text-blue-900 hover:bg-gray-100'
            }`}
          >
            Start assessment
          </a>

          {/* Mobile hamburger */}
          <button
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className={`md:hidden p-2 rounded-lg transition ${
              solidHeader ? 'text-slate-700 hover:bg-slate-100' : 'text-white hover:bg-white/10'
            }`}
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div id="mobile-menu" className="md:hidden bg-white border-t border-gray-100 px-6 pb-5">
          <nav className="flex flex-col gap-1 pt-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="rounded-lg px-3 py-2.5 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <a
                href="/signin"
                onClick={closeMenu}
                className="flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white hover:bg-slate-800 transition-colors"
              >
                Start assessment
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
