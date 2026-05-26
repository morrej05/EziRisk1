import { CheckCircle2 } from 'lucide-react';

const SIGNALS = [
  'Structured around PAS 79 workflows',
  'Built to support RR(FS)O 2005 reporting',
  'Locked issued reports with version history',
  'Evidence linked to findings',
  'Full audit trail',
  'Role-based review controls',
];

export default function TrustStrip() {
  return (
    <div className="border-b border-neutral-100 bg-neutral-50 py-4">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
          {SIGNALS.map((signal) => (
            <div key={signal} className="flex items-center gap-1.5 text-sm text-neutral-600">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary-600" />
              <span>{signal}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
