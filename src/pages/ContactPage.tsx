import { Link } from 'react-router-dom';
import { PUBLIC_LEGAL_DETAILS, getSupportMailto } from '../config/support';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 sm:p-8 lg:p-10">
          <div className="mb-8 border-b border-slate-200 pb-6">
            <Link to="/" className="inline-flex items-center text-sm font-medium text-slate-900 underline hover:text-slate-700">
              ← Back to Home
            </Link>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Contact EziRisk</h1>
            <p className="mt-3 text-slate-700 leading-relaxed">
              For platform enquiries, trial access, support or feedback regarding EziRisk.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
              <h2 className="text-lg font-semibold text-slate-900">Contact details</h2>
              <dl className="mt-4 space-y-3 text-sm text-slate-700">
                <div>
                  <dt className="font-medium text-slate-900">Email</dt>
                  <dd>
                    <a href={getSupportMailto(PUBLIC_LEGAL_DETAILS.contactEmail)} className="text-slate-900 underline hover:text-slate-700">
                      {PUBLIC_LEGAL_DETAILS.contactEmail}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-900">Website</dt>
                  <dd>
                    <a href={PUBLIC_LEGAL_DETAILS.website} className="text-slate-900 underline hover:text-slate-700">
                      {PUBLIC_LEGAL_DETAILS.website}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-900">Phone</dt>
                  <dd>
                    <a href={`tel:${PUBLIC_LEGAL_DETAILS.phone.replace(/\s/g, '')}`} className="text-slate-900 underline hover:text-slate-700">
                      {PUBLIC_LEGAL_DETAILS.phone}
                    </a>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
              <h2 className="text-lg font-semibold text-slate-900">Business / data protection</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-700 leading-relaxed">
                <p>EziRisk is operated by {PUBLIC_LEGAL_DETAILS.operator}.</p>
                <p><span className="font-medium text-slate-900">Operator / Data Controller:</span> {PUBLIC_LEGAL_DETAILS.dataController}</p>
                <p><span className="font-medium text-slate-900">ICO application number:</span> {PUBLIC_LEGAL_DETAILS.icoApplicationNumber}</p>
                <p>{PUBLIC_LEGAL_DETAILS.registrationPendingNote}</p>
              </div>
            </section>
          </div>

          <section className="mt-6 rounded-lg border border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-900">Operational note</h2>
            <p className="mt-3 text-sm text-slate-700 leading-relaxed">
              {PUBLIC_LEGAL_DETAILS.operationalNote}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
