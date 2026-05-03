export default function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between bg-white/10 backdrop-blur-md border-b border-white/10 rounded-b-xl">
        <div className="text-white font-bold text-xl">
          Ezi<span className="text-red-500">Risk</span>
        </div>

        <nav className="hidden md:flex items-center gap-8 text-white/90">
          <a href="#how" className="hover:text-white transition">How it works</a>
          <a href="#who" className="hover:text-white transition">Who it’s for</a>
          <a href="#pricing" className="hover:text-white transition">Pricing</a>
        </nav>

        <a
          href="/login"
          className="bg-white text-blue-900 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition"
        >
          Sign in
        </a>
      </div>
    </header>
  );
}
