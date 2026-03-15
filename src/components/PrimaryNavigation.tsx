import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, Shield } from 'lucide-react';
import { canAccessAdmin, canAccessPlatformSettings, type User as EntitlementsUser } from '../utils/entitlements';
import { useState } from 'react';

type AuthUserWithPlatform = { platform?: boolean };

export default function PrimaryNavigation() {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const [logoError, setLogoError] = useState(false);

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  const entitlementUser: EntitlementsUser | null = user
    ? {
        id: user.id,
        role: (user.role ?? 'viewer') as EntitlementsUser['role'],
        is_platform_admin: Boolean(user.is_platform_admin),
        platform: Boolean((user as AuthUserWithPlatform).platform),
        can_edit: Boolean(user.can_edit),
        name: user.user_metadata?.name ?? null,
        organisation_id: user.organisation_id ?? null,
      }
    : null;

  const navItems = [
    { label: 'Home', path: '/dashboard', show: true },
    { label: 'Assessments', path: '/assessments', show: true },
    { label: 'Remediation', path: '/remediation', show: true },
    { label: 'Portfolio', path: '/portfolio', show: true },
    { label: 'Admin', path: '/admin', show: entitlementUser ? canAccessAdmin(entitlementUser) : false },
    { label: 'Platform', path: '/platform', show: entitlementUser ? canAccessPlatformSettings(entitlementUser) : false },
  ];

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <nav className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-6">
            <Link
              to="/dashboard"
              className="flex items-center transition-opacity hover:opacity-80"
            >
              {!logoError ? (
                <img
                  src="/ezirisk-logo-primary.svg"
                  alt="EziRisk"
                  className="h-8"
                  onError={() => setLogoError(true)}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <div className="w-8 h-8 bg-gradient-to-r from-blue-700 to-blue-500 rounded flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <span className="text-xl font-bold text-slate-900">EziRisk</span>
                </div>
              )}
            </Link>

            <div className="flex items-center gap-2">
              {entitlementUser && canAccessAdmin(entitlementUser) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 text-xs font-medium">
                  <Shield className="h-3 w-3" />
                  Admin
                </span>
              )}
              {entitlementUser && canAccessPlatformSettings(entitlementUser) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 text-white border border-slate-900 px-2.5 py-1 text-xs font-medium">
                  <Shield className="h-3 w-3" />
                  Platform Admin
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {navItems.filter(item => item.show).map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive(item.path)
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}
