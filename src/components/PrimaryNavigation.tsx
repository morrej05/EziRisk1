import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Lock, LogOut, Menu, Shield, UserCircle, X } from 'lucide-react';
import { canAccessAdmin, canAccessPlatformSettings, canAccessPortfolio, type User as EntitlementsUser } from '../utils/entitlements';
import { useEffect, useState } from 'react';
import { resolveLogoUrl } from '../utils/logo';
import { resolveDisplayName } from '../utils/pdfIdentity';
import { needsDisplayName } from '../utils/displayNameGuard';

type AuthUserWithPlatform = { platform?: boolean };

export default function PrimaryNavigation() {
  const location = useLocation();
  const { signOut, user, organisation } = useAuth();
  const [logoError, setLogoError] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

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
        name: resolveDisplayName(user) ?? null,
        organisation_id: user.organisation_id ?? null,
      }
    : null;

  const isPlatformAdminUser = entitlementUser ? canAccessPlatformSettings(entitlementUser) : false;

  const portfolioLocked = !isPlatformAdminUser && !canAccessPortfolio(organisation);

  const navItems = [
    { label: 'Home', path: '/dashboard', show: true, locked: false },
    { label: 'Assessments', path: '/assessments', show: true, locked: false },
    { label: 'Remediation', path: '/remediation', show: true, locked: false },
    { label: 'Portfolio', path: '/portfolio', show: true, locked: portfolioLocked },
    {
      label: 'Admin',
      path: '/admin',
      show: entitlementUser ? canAccessAdmin(entitlementUser) && !location.pathname.startsWith('/admin') : false,
      locked: false,
    },
    { label: 'Platform', path: '/platform', show: isPlatformAdminUser, locked: false },
  ];

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="flex min-h-14 items-center justify-between gap-2 py-2 sm:min-h-16">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <Link to="/dashboard" className="flex items-center transition-opacity hover:opacity-80">
              {!logoError ? (
                <img src={resolveLogoUrl()} alt="EziRisk" className="h-8 w-auto sm:h-9" onError={() => setLogoError(true)} />
              ) : (
                <div className="flex items-center gap-1">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-r from-blue-700 to-blue-500">
                    <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <span className="text-xl font-bold text-slate-900">EziRisk</span>
                </div>
              )}
            </Link>

            <div className="hidden items-center gap-2 md:flex">
              {entitlementUser && canAccessAdmin(entitlementUser) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  <Shield className="h-3 w-3" />
                  Admin
                </span>
              )}
              {entitlementUser && canAccessPlatformSettings(entitlementUser) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-900 bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                  <Shield className="h-3 w-3" />
                  Platform Admin
                </span>
              )}
            </div>

            <div className="hidden items-center gap-1 lg:flex">
              {navItems.filter(item => item.show).map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    item.locked
                      ? 'text-slate-400 hover:bg-slate-50 hover:text-slate-500'
                      : isActive(item.path)
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {item.locked ? (
                    <span className="flex items-center gap-1.5">
                      {item.label}
                      <Lock className="h-3 w-3" />
                    </span>
                  ) : item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="hidden items-center gap-1 lg:flex">
            {user && (
              <Link
                to="/profile"
                title="Go to profile settings"
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  needsDisplayName(user)
                    ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <UserCircle className="h-4 w-4 flex-shrink-0" />
                <span className="max-w-[160px] truncate">
                  {needsDisplayName(user)
                    ? 'Set your name'
                    : (resolveDisplayName(user) ?? user.email ?? 'My profile')}
                </span>
              </Link>
            )}

            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(open => !open)}
            className="inline-flex items-center justify-center rounded-md border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-slate-200 bg-white lg:hidden">
          <div className="space-y-2 px-3 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 pb-1">
              {entitlementUser && canAccessAdmin(entitlementUser) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  <Shield className="h-3 w-3" />
                  Admin
                </span>
              )}
              {entitlementUser && canAccessPlatformSettings(entitlementUser) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-900 bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                  <Shield className="h-3 w-3" />
                  Platform Admin
                </span>
              )}
            </div>

            {navItems.filter(item => item.show).map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${
                  item.locked
                    ? 'text-slate-400'
                    : isActive(item.path)
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{item.label}</span>
                {item.locked && <Lock className="h-3 w-3" />}
              </Link>
            ))}

            {user && (
              <Link
                to="/profile"
                className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm ${
                  needsDisplayName(user)
                    ? 'border border-amber-200 bg-amber-50 text-amber-700'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <UserCircle className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">
                  {needsDisplayName(user)
                    ? 'Set your name'
                    : (resolveDisplayName(user) ?? user.email ?? 'My profile')}
                </span>
              </Link>
            )}

            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
