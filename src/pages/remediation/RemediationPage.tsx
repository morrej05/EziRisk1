import { Link, Outlet, useLocation } from 'react-router-dom';

const subNavItems = [
  { label: 'Actions', path: '/remediation/actions' },
  { label: 'Recommendations', path: '/remediation/recommendations' },
];

export default function RemediationPage() {
  const location = useLocation();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Remediation</h1>
        <p className="mt-2 text-slate-600">
          Manage remediation workflows across assessment actions and Risk Engineering recommendations.
        </p>
      </div>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-2" aria-label="Remediation section navigation">
          {subNavItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`rounded-t-md border px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-slate-300 border-b-white bg-white text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <Outlet />
    </div>
  );
}
