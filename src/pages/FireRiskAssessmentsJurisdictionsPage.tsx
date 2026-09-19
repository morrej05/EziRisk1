import { ArrowRight, BookOpen, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import Footer from '../components/landing/Footer';
import Navbar from '../components/landing/Navbar';

const assessmentConsiderations = [
  'people at risk',
  'potential ignition sources and combustible materials',
  'means of escape',
  'fire detection and warning',
  'firefighting equipment',
  'emergency arrangements',
  'staff information and training',
  'maintenance and management arrangements',
];

const jurisdictionImpacts = [
  'legal references',
  'terminology used in the report',
  'guidance referenced',
  'recording requirements',
  'recommendations',
  'report wording',
  'management responsibilities',
];

export default function FireRiskAssessmentsJurisdictionsPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Navbar />
      <main>
        <header className="relative overflow-hidden bg-gradient-to-br from-[#0b2f45] via-[#0e4966] to-[#126b77] pb-20 pt-32 text-white lg:pb-24 lg:pt-40">
          <div className="absolute inset-0 opacity-15 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:28px_28px]" />
          <div className="relative mx-auto max-w-5xl px-6">
            <div className="mb-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Insights
            </div>
            <h1 className="max-w-4xl text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              Fire Risk Assessments in England, Wales and Scotland: What Changes?
            </h1>
            <p className="mt-7 max-w-3xl text-lg leading-8 text-slate-100 sm:text-xl">
              Fire risk assessment principles are broadly similar across Great Britain, but the legal framework is not identical in England, Wales and Scotland.
            </p>
            <p className="mt-4 max-w-3xl leading-7 text-slate-300">
              For consultants working across different parts of the UK, that matters. The assessment process may look familiar, but the legislation, terminology and supporting guidance can differ.
            </p>
          </div>
        </header>

        <article className="mx-auto max-w-5xl px-6 py-16 lg:py-24">
          <div className="max-w-3xl space-y-16">
            <section>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900">England and Wales</h2>
              <div className="mt-6 space-y-5 text-lg leading-8 text-slate-600">
                <p>In England and Wales, the main framework for fire safety in non-domestic premises is the Regulatory Reform (Fire Safety) Order 2005.</p>
                <p>The responsible person must ensure that a suitable and sufficient fire risk assessment is carried out and that appropriate fire precautions are put in place.</p>
                <p>The assessment should consider matters such as:</p>
                <ul className="grid gap-3 border-l-2 border-primary-200 pl-6 sm:grid-cols-2">
                  {assessmentConsiderations.map((item) => (
                    <li key={item} className="flex gap-3"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-primary-700" aria-hidden="true" /><span>{item}</span></li>
                  ))}
                </ul>
                <p>The assessment must also be reviewed when there is reason to suspect that it is no longer valid or when significant changes are made to the premises.</p>
                <p>Wales follows the same core Fire Safety Order framework, although Welsh Government guidance and enforcement arrangements should be followed where applicable.</p>
                <p>Recent changes have also strengthened recording requirements. Responsible persons must record the fire risk assessment and fire safety arrangements, rather than simply relying on a record of significant findings.</p>
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900">Scotland</h2>
              <div className="mt-6 space-y-5 text-lg leading-8 text-slate-600">
                <p>Scotland has a separate legislative framework.</p>
                <p>Fire safety duties for most non-domestic premises are principally contained in Part 3 of the Fire (Scotland) Act 2005 and the Fire Safety (Scotland) Regulations 2006.</p>
                <p>The underlying principles are familiar: identify people at risk, identify fire hazards, evaluate existing precautions, determine whether further measures are required, record the findings and keep the assessment under review.</p>
                <p>However, Scottish Government guidance and terminology should be used when assessing premises in Scotland.</p>
                <p>The Scottish guidance makes clear that a fire safety risk assessment should be specific to the particular premises. A generic assessment is not sufficient.</p>
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900">Why jurisdiction matters</h2>
              <div className="mt-6 space-y-5 text-lg leading-8 text-slate-600">
                <p>A fire risk assessment template should not simply swap the address at the top of the report.</p>
                <p>The assessor should be working within the correct legislative and guidance framework for the location of the premises.</p>
                <p>That can affect:</p>
                <ul className="grid gap-3 rounded-2xl bg-slate-50 p-6 sm:grid-cols-2">
                  {jurisdictionImpacts.map((item) => (
                    <li key={item} className="flex gap-3"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-700" /><span>{item}</span></li>
                  ))}
                </ul>
                <p>For consultants operating across England, Wales and Scotland, maintaining separate Word templates can quickly become difficult to control.</p>
              </div>
            </section>

            <section className="rounded-3xl bg-[#0b3046] p-8 text-white shadow-xl sm:p-10">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">Jurisdiction-aware reporting</p>
              <h2 className="mt-3 text-3xl font-bold">How EziRisk helps</h2>
              <div className="mt-6 space-y-5 text-lg leading-8 text-slate-200">
                <p>EziRisk supports jurisdiction-aware fire risk assessment reporting across England, Wales and Scotland.</p>
                <p>The assessor can work through a structured assessment, capture evidence and photographs, create recommendations and produce a clear action register while maintaining the appropriate reporting framework for the location of the premises.</p>
                <p>This helps reduce the risk of outdated wording or jurisdiction-specific references being carried across from previous reports.</p>
                <p>EziRisk also helps keep findings, recommendations and follow-up actions linked throughout the assessment and final report.</p>
                <p>Learn more about EziRisk fire risk assessment software:</p>
              </div>
              <Link to="/fire-risk-assessment-software" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 font-semibold text-[#0b3b55] transition hover:bg-cyan-50">
                Explore fire risk assessment software <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            </section>

            <section>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900">A consistent process, without pretending the law is identical</h2>
              <div className="mt-6 space-y-5 text-lg leading-8 text-slate-600">
                <p>The fundamentals of good fire risk assessment remain consistent: understand the premises, understand the people at risk, identify fire hazards, evaluate the precautions and record what needs to be improved.</p>
                <p>But the legal framework still matters.</p>
                <p>For assessors working across Great Britain, the aim should be consistency in the assessment process without losing sight of the jurisdiction in which the premises is located.</p>
              </div>
            </section>
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}
