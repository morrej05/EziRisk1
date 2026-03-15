import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessAdmin, type User as EntitlementsUser } from '../utils/entitlements';

interface AdminRouteProps {
  children: ReactNode;
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const { user, loading } = useAuth();

  const entitlementUser: EntitlementsUser | null = user
    ? {
        id: user.id,
        role: (user.role ?? 'viewer') as EntitlementsUser['role'],
        is_platform_admin: Boolean(user.is_platform_admin),
        platform: Boolean(user.platform),
        can_edit: Boolean(user.can_edit),
        name: user.user_metadata?.name ?? null,
        organisation_id: user.organisation_id ?? null,
      }
    : null;

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

  if (!entitlementUser || !canAccessAdmin(entitlementUser)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
