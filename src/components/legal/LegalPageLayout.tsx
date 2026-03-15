import { Link } from 'react-router-dom';
import { LegalDocumentContent } from '../../content/legalContent';
import { SUPPORT_CONFIG, getSupportMailto } from '../../config/support';

interface LegalPageLayoutProps {
  content: LegalDocumentContent;
}

export default function LegalPageLayout({ content }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 sm:p-8 lg:p-10">
          <div className="mb-8 border-b border-slate-200 pb-6">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">{content.title}</h1>
            <p className="mt-2 text-sm text-slate-500">{content.lastUpdated}</p>
          </div>

          <div className="space-y-4 text-slate-700 leading-relaxed">
            {content.intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <div className="mt-8 space-y-7">
            {content.sections.map((section) => (
              <section key={section.heading} className="space-y-3">
                <h2 className="text-xl font-semibold text-slate-900">{section.heading}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="text-slate-700 leading-relaxed">
                    {paragraph}
                  </p>
                ))}
                {section.bullets && (
                  <ul className="list-disc pl-6 space-y-2 text-slate-700 leading-relaxed">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <div className="mt-10 pt-6 border-t border-slate-200 text-sm text-slate-600 space-y-2">
            <p>
              Return to <Link to="/" className="text-slate-900 underline hover:text-slate-700">EziRisk home</Link>.
            </p>
            <p>
              Need help? Contact us at{' '}
              <a href={getSupportMailto()} className="text-slate-900 underline hover:text-slate-700">
                {SUPPORT_CONFIG.email}
              </a>
              {' '}or{' '}
              <a href={getSupportMailto(SUPPORT_CONFIG.legalEmail)} className="text-slate-900 underline hover:text-slate-700">
                {SUPPORT_CONFIG.legalEmail}
              </a>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
