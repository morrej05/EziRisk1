import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Camera,
  Check,
  ClipboardCheck,
  FileCheck2,
  FileStack,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Navbar from '../components/landing/Navbar';
import Footer from '../components/landing/Footer';

const problems = [
  ['Word template formatting', 'Spend less time repairing page layouts, tables and numbering whenever assessment content changes.'],
  ['Repeated manual text', 'Reuse client and site details so repeat work starts with reliable information rather than another blank document.'],
  ['Photos and evidence', 'Keep photographic evidence with the relevant finding instead of matching loose files to notes after the visit.'],
  ['Inconsistent recommendations', 'Create clear, prioritised recommendations in a consistent format across assessors and sites.'],
  ['Separate action registers', 'Bring recommendations and action tracking together, without maintaining a disconnected spreadsheet.'],
  ['Repeat assessments and version control', 'Manage review assessments and report versioning while preserving a clear record of issued work.'],
];

const workflow = [
  'Assess',
  'Record evidence',
  'Create recommendations',
  'Review actions',
  'Issue report',
];

const features = [
  { icon: ClipboardCheck, title: 'Structured assessment forms', copy: 'Follow a consistent FRA workflow designed to make information easier to capture and review.' },
  { icon: Camera, title: 'Photographic evidence', copy: 'Add photographs to support findings and keep evidence connected to the assessment record.' },
  { icon: FileCheck2, title: 'Significant findings', copy: 'Record significant findings clearly and carry them into a professional reporting workflow.' },
  { icon: ListChecks, title: 'Prioritised recommendations', copy: 'Set out recommended improvements with priorities that help clients understand what needs attention.' },
  { icon: Check, title: 'Action register', copy: 'Review recommendations and track actions in one place after the assessment is complete.' },
  { icon: ShieldCheck, title: 'Branded PDF reports', copy: 'Issue professional reports with your consultancy branding and a clear action register.' },
  { icon: FileStack, title: 'Report issue and versioning', copy: 'Control report issue and retain identifiable versions as assessments are reviewed and updated.' },
  { icon: RefreshCw, title: 'Client and site reuse', copy: 'Reuse core client and premises information across repeat and multi-site assessment work.' },
];

const audiences = [
  ['Independent fire risk assessors', 'A focused workflow for assessors who want to spend more time assessing and less time formatting.'],
  ['Fire safety consultants', 'A consistent way to collect findings, evidence and recommendations for client-ready reports.'],
  ['Small fire consultancies', 'Shared reporting standards that help a growing team produce coherent work.'],
  ['Multi-site assessors', 'Reusable client and site records for portfolios, review programmes and repeat visits.'],
];

const faqs = [
  ['What is fire risk assessment software?', 'Fire risk assessment software helps assessors capture premises information, findings, evidence and recommendations in a structured workflow, then prepare an FRA report and associated action register.'],
  ['Can EziRisk produce branded FRA reports?', 'Yes. EziRisk can produce branded PDF reports so consultancies can issue professional FRA documents under their own identity.'],
  ['Can photographs be added to findings?', 'Yes. Photographic evidence can be recorded to support findings and remain connected to the assessment.'],
  ['Can recommendations be prioritised and tracked?', 'Yes. Recommendations can be prioritised and brought into an action register for review and action tracking.'],
  ['Does EziRisk support England, Wales and Scotland?', 'EziRisk supports jurisdiction-aware fire risk assessment reporting workflows for work in England, Wales and Scotland.'],
  ['Can repeat/review assessments be managed?', 'Yes. Client and site reuse, repeat assessment workflows and report versioning help assessors manage reviews without rebuilding every record from scratch.'],
];

export default function FireRiskAssessmentSoftwarePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Navbar />
      <main>
        <section className="relative overflow-hidden bg-gradient-to-br from-[#0b2f45] via-[#0e4966] to-[#126b77] pt-32 pb-20 text-white lg:pt-40 lg:pb-28">
          <div className="absolute inset-0 opacity-15 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:28px_28px]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-[1.08fr_.92fr]">
            <div>
              <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">FRA reporting software for UK professionals</p>
              <h1 className="max-w-4xl text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
                Fire Risk Assessment Software for Professional Assessors
              </h1>
              <p className="mt-7 max-w-3xl text-lg leading-8 text-slate-100 sm:text-xl">
                EziRisk helps fire risk assessors complete structured assessments, record evidence, create recommendations, track actions and issue professional branded FRA reports.
              </p>
              <p className="mt-4 max-w-2xl leading-7 text-slate-300">
                Built for independent assessors and small fire safety consultancies that need a clear path from site visit to issued report.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link to="/signin" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3.5 font-semibold text-[#0b3b55] transition hover:bg-cyan-50">
                  Try EziRisk for your next FRA <ArrowRight className="h-5 w-5" />
                </Link>
                <Link to="/contact" className="inline-flex items-center justify-center rounded-lg border border-white/40 px-6 py-3.5 font-semibold text-white transition hover:bg-white/10">
                  Talk to EziRisk
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl bg-cyan-300/10 blur-2xl" />
              <img src="/hero-risk.webp" alt="Fire risk assessor recording site evidence for an FRA report" className="relative aspect-[4/3] w-full rounded-2xl border border-white/20 object-cover shadow-2xl" />
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">Less document administration</p>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Problems EziRisk helps solve</h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">Move fire risk assessment reporting out of disconnected templates, folders and spreadsheets and into one structured workflow.</p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {problems.map(([title, copy]) => (
                <article key={title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="font-semibold text-slate-900">{title}</h3>
                  <p className="mt-3 leading-7 text-slate-600">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-6 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">How EziRisk works</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">One connected route to report issue</h2>
            <div className="mt-12 grid gap-3 md:grid-cols-5">
              {workflow.map((step, index) => (
                <div key={step} className="relative rounded-xl border border-slate-200 bg-white px-4 py-6 shadow-sm">
                  <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-800">{index + 1}</span>
                  <h3 className="mt-4 font-semibold">{step}</h3>
                  {index < workflow.length - 1 && <ArrowRight className="absolute -right-5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-primary-500 md:block" />}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0b3046] py-20 text-white lg:py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">Core FRA features</p>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Built around professional assessment work</h2>
            </div>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-white/15 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, copy }) => (
                <article key={title} className="bg-[#0e3a52] p-7">
                  <Icon className="h-7 w-7 text-cyan-300" />
                  <h3 className="mt-5 font-semibold text-white">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">Jurisdiction-aware reporting</p>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">England, Wales and Scotland</h2>
              <p className="mt-6 text-lg leading-8 text-slate-600">EziRisk supports jurisdiction-aware fire risk assessment reporting across England, Wales and Scotland. Assessors can select the relevant jurisdiction and keep that context with the assessment and report.</p>
              <p className="mt-4 leading-7 text-slate-600">The platform supports your reporting process; professional judgement and responsibility for the assessment remain with the competent assessor.</p>
            </div>
            <div className="rounded-2xl border border-primary-100 bg-primary-50 p-8 sm:p-10">
              <Building2 className="h-9 w-9 text-primary-700" />
              <h3 className="mt-5 text-xl font-semibold">A consistent workflow, with the right context</h3>
              <p className="mt-3 leading-7 text-slate-600">Keep structured assessments, photo evidence, recommendations and branded PDF reports together while recording where the premises is located.</p>
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">Who it is for</p>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">FRA software for focused teams</h2>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {audiences.map(([title, copy]) => (
                <article key={title} className="flex gap-5 rounded-xl border border-slate-200 bg-white p-6">
                  <UserRound className="mt-1 h-6 w-6 shrink-0 text-primary-700" />
                  <div><h3 className="font-semibold">{title}</h3><p className="mt-2 leading-7 text-slate-600">{copy}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 lg:py-24">
          <div className="mx-auto max-w-4xl px-6">
            <div className="text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">Frequently asked questions</p>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Fire risk assessment software FAQs</h2>
            </div>
            <div className="mt-12 divide-y divide-slate-200 border-y border-slate-200">
              {faqs.map(([question, answer]) => (
                <details key={question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900">
                    {question}<span className="text-2xl font-light text-primary-700 group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 max-w-3xl leading-7 text-slate-600">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-primary-50 py-20">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">Try EziRisk for your next fire risk assessment</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">See how structured fire risk assessment software can take you from evidence capture to a clear, branded report.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/signin" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-700 px-7 py-3.5 font-semibold text-white transition hover:bg-primary-800">Start free trial <ArrowRight className="h-5 w-5" /></Link>
              <Link to="/contact" className="inline-flex items-center justify-center rounded-lg border border-primary-300 bg-white px-7 py-3.5 font-semibold text-primary-800 transition hover:bg-primary-50">Contact EziRisk</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
