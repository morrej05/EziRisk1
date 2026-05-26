export default function HeroScreenshot() {
  return (
    <section className="bg-white pt-10 pb-10 sm:pt-14 sm:pb-12">
      <div className="mx-auto max-w-5xl px-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 shadow-[0_24px_64px_-12px_rgba(15,30,80,0.18)] ring-1 ring-black/[0.04]">
          {/* Minimal browser chrome */}
          <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300"></span>
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300"></span>
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300"></span>
            <span className="ml-3 rounded bg-slate-200/70 px-3 py-0.5 text-xs text-slate-400 hidden sm:inline-block">
              app.ezirisk.com
            </span>
          </div>
          <img
            src="/images/portfolio-dashboard.png"
            alt="EziRisk assessment dashboard overview"
            className="block w-full"
          />
        </div>
      </div>
    </section>
  );
}
