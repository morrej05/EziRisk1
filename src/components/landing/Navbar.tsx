import { useEffect, useState } from 'react';

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${
        isScrolled ? 'bg-white border-b border-gray-200' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className={`transition-all duration-300 ${isScrolled ? '' : 'bg-white/85 rounded-md px-2 py-1 shadow-sm'}`}>
          <img
            src="/ezirisk-logo-primary.svg"
            alt="EziRisk"
            className={`h-9 w-auto transition-all duration-300 ${
              isScrolled ? '' : 'drop-shadow-[0_1px_8px_rgba(255,255,255,0.45)]'
            }`}
          />
        </div>

        <nav className={`hidden md:flex items-center gap-8 transition-colors ${isScrolled ? 'text-slate-700' : 'text-white/90'}`}>
          <a href="#how" className={`transition ${isScrolled ? 'hover:text-slate-900' : 'hover:text-white'}`}>How it works</a>
          <a href="#who" className={`transition ${isScrolled ? 'hover:text-slate-900' : 'hover:text-white'}`}>Who it’s for</a>
          <a href="/pricing" className={`transition ${isScrolled ? 'hover:text-slate-900' : 'hover:text-white'}`}>Pricing</a>
          <a href="/security" className={`transition ${isScrolled ? 'hover:text-slate-900' : 'hover:text-white'}`}>Security</a>
        </nav>

        <a
          href="/signin"
          className={`px-4 py-2 rounded-lg font-medium transition ${
            isScrolled ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-white text-blue-900 hover:bg-gray-100'
          }`}
        >
          Sign in
        </a>
      </div>
    </header>
  );
}
