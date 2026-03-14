import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessPlatformSettings, type User as EntitlementsUser } from '../utils/entitlements';

type AuthUserWithPlatform = { platform?: boolean };

interface PlatformAdminRouteProps {
  children: ReactNode;
}

export default function PlatformAdminRoute({ children }: PlatformAdminRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/signin" replace />;
  }

  const entitlementUser: EntitlementsUser = {
    id: user.id,
    role: (user.role ?? 'viewer') as EntitlementsUser['role'],
    is_platform_admin: Boolean(user.is_platform_admin),
    platform: Boolean((user as AuthUserWithPlatform).platform),
    can_edit: Boolean(user.can_edit),
    name: user.user_metadata?.name ?? null,
    organisation_id: user.organisation_id ?? null,
  };

  if (!canAccessPlatformSettings(entitlementUser)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
