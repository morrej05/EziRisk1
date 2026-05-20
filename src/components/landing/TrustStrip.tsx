import { CheckCircle2 } from 'lucide-react';

const SIGNALS = [
  'Evidence linked to findings',
  'Version-controlled issued reports',
  'Review and issue controls',
  'Role-based access',
  'Traceable recommendations',
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
