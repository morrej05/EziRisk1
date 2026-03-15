import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserRole, SubscriptionPlan, DisciplineType } from '../utils/permissions';
import { Organisation } from '../utils/entitlements';
import { CURRENT_DISCLAIMER_VERSION } from '../config/legal';

// Enriched user object that combines auth + profile data
interface AppUser extends User {
  role?: UserRole;
  is_platform_admin?: boolean;
  platform?: boolean;
  can_edit?: boolean;
  organisation_id?: string | null;
  name?: string | null;
}

type ProfileRecord = {
  plan?: string | null;
  discipline_type?: DisciplineType | null;
  bolt_ons?: string[] | null;
  max_editors?: number | null;
  active_editors?: number | null;
  role?: string | null;
  is_platform_admin?: boolean | null;
  can_edit?: boolean | null;
  organisation_id?: string | null;
  name?: string | null;
  organisations?: OrganisationRecord | null;
};

type MembershipRecord = {
  role?: string | null;
  organisation_id: string;
  status: string;
  created_at?: string;
};

type OrganisationRecord = {
  id: string;
  name: string;
  plan_type?: string | null;
  plan_id?: string | null;
  discipline_type: DisciplineType;
  enabled_addons?: string[] | null;
  max_editors?: number | null;
  subscription_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  billing_cycle?: 'monthly' | 'annual' | null;
  created_at?: string;
  updated_at?: string;
};

interface AuthContextType {
  user: AppUser | null;
  userRole: UserRole | null;
  userPlan: SubscriptionPlan | null;
  disciplineType: DisciplineType | null;
  boltOns: string[];
  maxEditors: number;
  activeEditors: number;
  isPlatformAdmin: boolean;
  canEdit: boolean;
  organisation: Organisation | null;
  roleError: string | null;
  hasAcceptedCurrentDisclaimer: boolean;
  disclaimerAcceptedAt: string | null;
  loading: boolean;
  authInitialized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  refreshUserRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userPlan, setUserPlan] = useState<SubscriptionPlan | null>(null);
  const [disciplineType, setDisciplineType] = useState<DisciplineType | null>(null);
  const [boltOns, setBoltOns] = useState<string[]>([]);
  const [maxEditors, setMaxEditors] = useState<number>(999);
  const [activeEditors, setActiveEditors] = useState<number>(1);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean>(false);
  const [canEdit, setCanEdit] = useState<boolean>(false);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [hasAcceptedCurrentDisclaimer, setHasAcceptedCurrentDisclaimer] = useState(false);
  const [disclaimerAcceptedAt, setDisclaimerAcceptedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);

  // Helper to create enriched user object with profile fields
  const createAppUser = (authUser: User | null, profile: ProfileRecord | null): AppUser | null => {
    if (!authUser) return null;

    const platformAdmin = profile?.is_platform_admin === true;

    return {
      ...authUser,
      role: profile?.role,
      is_platform_admin: platformAdmin,
      platform: platformAdmin,
      can_edit: profile?.can_edit || false,
      organisation_id: profile?.organisation_id,
      name: profile?.name || null,
    };
  };

  const resolvePlatformAdmin = (profile: ProfileRecord | null): boolean => {
    return profile?.is_platform_admin === true;
  };

  const buildFallbackOrganisation = (
    organisationId: string,
    profile: ProfileRecord,
    userRoleValue: UserRole | null
  ): Organisation => {
    const isAdmin = userRoleValue === 'admin' || resolvePlatformAdmin(profile);

    return {
      id: organisationId,
      name: 'Your Organisation',
      plan_type: profile.plan || 'free',
      plan_id: profile.plan || 'free',
      discipline_type: (profile.discipline_type as DisciplineType) || 'FIRE',
      enabled_addons: Array.isArray(profile.bolt_ons) ? profile.bolt_ons : [],
      max_editors: profile.max_editors || 0,
      subscription_status: 'active',
      permissions: {
        can_manage_users: isAdmin,
        can_edit_all_assessments: isAdmin,
        can_access_billing: isAdmin,
      },
      settings: {
        default_assessment_types: ['FRA'],
        custom_risk_matrix: false,
      },
    };
  };

  const resolveCurrentMembership = (
    activeMemberships: MembershipRecord[],
    profileOrganisationId: string | null
  ): MembershipRecord | null => {
    if (!activeMemberships.length) {
      return null;
    }

    if (profileOrganisationId) {
      const profileMatchedMembership = activeMemberships.find((item) => item.organisation_id === profileOrganisationId);
      if (profileMatchedMembership) {
        return profileMatchedMembership;
      }
    }

    return activeMemberships[0] ?? null;
  };

  const normalizeRole = (role: string | null | undefined): UserRole | null => {
    if (!role) return null;

    switch (role) {
      case 'admin':
      case 'surveyor':
      case 'viewer':
        return role;
      case 'owner':
      case 'org_admin':
      case 'super_admin':
        return 'admin';
      case 'consultant':
      case 'user':
        return 'surveyor';
      default:
        return null;
    }
  };

  const fetchDisclaimerStatus = async (userId: string) => {
    const { data, error } = await supabase
      .from('user_legal_acceptances')
      .select('accepted_at')
      .eq('user_id', userId)
      .eq('legal_document_type', 'disclaimer')
      .eq('version', CURRENT_DISCLAIMER_VERSION)
      .maybeSingle();

    if (error) {
      console.warn('[AuthContext] Failed to fetch disclaimer status:', error.message);
      setHasAcceptedCurrentDisclaimer(false);
      setDisclaimerAcceptedAt(null);
      return;
    }

    setHasAcceptedCurrentDisclaimer(Boolean(data?.accepted_at));
    setDisclaimerAcceptedAt(data?.accepted_at ?? null);
  };

  const fetchUserRole = async (userId: string, userEmail: string, authUser: User) => {
    try {
      setRoleError(null);
      console.log('[AuthContext] 🔍 Fetching user profile for:', userId, userEmail);

      const { data: memberships, error: membershipError } = await supabase
        .from('organisation_members')
        .select('role, organisation_id, status, created_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (membershipError) {
        console.warn('[AuthContext] Membership fetch warning:', membershipError.message);
      }

      const { data: profile, error: fetchError } = await supabase
        .from('user_profiles')
        .select('name, role, plan, discipline_type, bolt_ons, max_editors, active_editors, is_platform_admin, can_edit, organisation_id, organisations(*)')
        .eq('id', userId)
        .maybeSingle();

      console.log('[AuthContext] 📦 Profile fetch result:', { profile, error: fetchError });

      if (fetchError) {
        const errorMsg = `Database error: ${fetchError.message} (Code: ${fetchError.code})`;
        console.error('[AuthContext] ❌ Profile fetch error:', errorMsg, fetchError);
        setRoleError(errorMsg);
        setUserRole(null);
        setUserPlan(null);
        setDisciplineType(null);
        setBoltOns([]);
        setMaxEditors(999);
        setActiveEditors(1);
        setIsPlatformAdmin(false);
        setCanEdit(false);
        setOrganisation(null);
        setLoading(false);
        return;
      }

      if (!profile) {
        console.warn('[AuthContext] ⚠️ User profile not found for:', userId);
        const errorMsg = 'User profile not found. Please contact support.';
        setRoleError(errorMsg);
        setUserRole(null);
        setUserPlan(null);
        setDisciplineType(null);
        setBoltOns([]);
        setMaxEditors(999);
        setActiveEditors(1);
        setIsPlatformAdmin(false);
        setCanEdit(false);
        setOrganisation(null);
        setLoading(false);
        return;
      }

      console.log('[AuthContext] ✅ Successfully fetched profile:', profile);

      const activeMemberships = (memberships ?? []) as MembershipRecord[];
      const profileOrganisationId = profile.organisation_id ?? null;
      const profileMembership = profileOrganisationId
        ? activeMemberships.find((item) => item.organisation_id === profileOrganisationId)
        : undefined;
      const fallbackMembership = activeMemberships[0];
      const resolvedMembership = resolveCurrentMembership(activeMemberships, profileOrganisationId);

      // Update user object with profile fields
      const resolvedRole = normalizeRole((resolvedMembership?.role as string | null | undefined) ?? profile.role);
      const resolvedOrganisationId = resolvedMembership?.organisation_id ?? profileOrganisationId ?? null;

      console.log('[AuthContext] 🧭 Organisation resolution:', {
        profileOrganisationId,
        activeMembershipCount: activeMemberships.length,
        usedProfileOrganisationMembership: Boolean(profileMembership),
        fallbackMembershipOrganisationId: fallbackMembership?.organisation_id ?? null,
        resolvedOrganisationId,
      });

      if (!resolvedOrganisationId) {
        console.warn('[AuthContext] ⛔ No organisation context found from membership or profile');
        setUser(createAppUser(authUser, {
          ...profile,
          role: resolvedRole,
          organisation_id: null,
        }));
        await fetchDisclaimerStatus(userId);
        setRoleError('Organisation context is missing. Please contact support.');
        setUserRole(resolvedRole);
        setUserPlan(profile.plan as SubscriptionPlan);
        setDisciplineType(profile.discipline_type as DisciplineType);
        setBoltOns(Array.isArray(profile.bolt_ons) ? profile.bolt_ons : []);
        setMaxEditors(profile.max_editors || 999);
        setActiveEditors(profile.active_editors || 1);
        setIsPlatformAdmin(resolvePlatformAdmin(profile));
        setCanEdit(profile.can_edit || false);
        setOrganisation(null);
        return;
      }

      let organisationRecord: OrganisationRecord | null = (profile.organisations as OrganisationRecord) ?? null;
      if (resolvedOrganisationId && (!organisationRecord || organisationRecord.id !== resolvedOrganisationId)) {
        const { data: membershipOrg, error: membershipOrgError } = await supabase
          .from('organisations')
          .select('*')
          .eq('id', resolvedOrganisationId)
          .maybeSingle();

        if (!membershipOrgError && membershipOrg) {
          organisationRecord = membershipOrg as OrganisationRecord;
        }
      }

      setUser(createAppUser(authUser, {
        ...profile,
        role: resolvedRole,
        organisation_id: resolvedOrganisationId,
      }));
      await fetchDisclaimerStatus(userId);

      // Auto-create organisation only when there is no organisation id context at all.
      if (!resolvedOrganisationId) {
        console.log('[AuthContext] 🏥 Organisation missing - auto-healing...');
        try {
          const { data: newOrgId, error: rpcError } = await supabase.rpc('ensure_org_for_user', { user_id: userId });

          if (rpcError) {
            console.error('[AuthContext] ❌ Failed to create organisation:', rpcError);
            throw rpcError;
          }

          console.log('[AuthContext] ✅ Organisation created:', newOrgId);

          // Re-fetch profile with new organisation
          const { data: updatedProfile, error: refetchError } = await supabase
            .from('user_profiles')
            .select('role, plan, discipline_type, bolt_ons, max_editors, active_editors, is_platform_admin, can_edit, organisation_id, organisations(*)')
            .eq('id', userId)
            .maybeSingle();

          if (refetchError || !updatedProfile) {
            console.error('[AuthContext] ❌ Failed to refetch profile:', refetchError);
            throw new Error('Failed to load organisation after creation');
          }

          console.log('[AuthContext] ✅ Profile refetched with organisation:', updatedProfile);

          // Update user object with profile fields
          setUser(createAppUser(authUser, updatedProfile));

          // Use the updated profile
          setUserRole(normalizeRole((resolvedMembership?.role as string | null | undefined) ?? updatedProfile.role));
          setUserPlan(updatedProfile.plan as SubscriptionPlan);
          setDisciplineType(updatedProfile.discipline_type as DisciplineType);
          setBoltOns(Array.isArray(updatedProfile.bolt_ons) ? updatedProfile.bolt_ons : []);
          setMaxEditors(updatedProfile.max_editors || 999);
          setActiveEditors(updatedProfile.active_editors || 1);
          setIsPlatformAdmin(resolvePlatformAdmin(updatedProfile));
          setCanEdit(updatedProfile.can_edit || false);

          if (updatedProfile.organisations) {
            const org = updatedProfile.organisations as OrganisationRecord;
            const orgData = {
              id: org.id,
              name: org.name,
              plan_type: org.plan_type || org.plan_id || 'free',
              plan_id: org.plan_id || org.plan_type || 'free',
              discipline_type: org.discipline_type,
              enabled_addons: Array.isArray(org.enabled_addons) ? org.enabled_addons : [],
              max_editors: org.max_editors || 0,
              subscription_status: org.subscription_status || 'active',
              stripe_customer_id: org.stripe_customer_id,
              stripe_subscription_id: org.stripe_subscription_id,
              billing_cycle: org.billing_cycle,
              created_at: org.created_at,
              updated_at: org.updated_at,
            };
            console.log('[AuthContext] 🏢 Organisation loaded:', {
              id: orgData.id,
              name: orgData.name,
              plan_id: orgData.plan_id,
              plan_type: orgData.plan_type
            });
            setOrganisation(orgData);
          }
        } catch (autoHealError) {
          console.error('[AuthContext] ❌ Auto-heal failed:', autoHealError);
          setRoleError('Failed to create organisation. Please contact support.');
        }
      } else if (!organisationRecord) {
        console.warn('[AuthContext] ⚠️ Organisation record unavailable, using profile fallback context');
        setOrganisation(buildFallbackOrganisation(resolvedOrganisationId, profile, resolvedRole));
      } else {
        // Organisation exists, use it
        // User object already updated above
        setUserRole(resolvedRole);
        setUserPlan(profile.plan as SubscriptionPlan);
        setDisciplineType(profile.discipline_type as DisciplineType);
        setBoltOns(Array.isArray(profile.bolt_ons) ? profile.bolt_ons : []);
        setMaxEditors(profile.max_editors || 999);
        setActiveEditors(profile.active_editors || 1);
        setIsPlatformAdmin(resolvePlatformAdmin(profile));
        setCanEdit(profile.can_edit || false);

        const org = organisationRecord as OrganisationRecord;
        const orgData = {
          id: org.id,
          name: org.name,
          plan_type: org.plan_type || org.plan_id || 'free',
          plan_id: org.plan_id || org.plan_type || 'free',
          discipline_type: org.discipline_type,
          enabled_addons: Array.isArray(org.enabled_addons) ? org.enabled_addons : [],
          max_editors: org.max_editors || 0,
          subscription_status: org.subscription_status || 'active',
          stripe_customer_id: org.stripe_customer_id,
          stripe_subscription_id: org.stripe_subscription_id,
          billing_cycle: org.billing_cycle,
          created_at: org.created_at,
          updated_at: org.updated_at,
        };
        console.log('[AuthContext] 🏢 Organisation loaded:', {
          id: orgData.id,
          name: orgData.name,
          plan_id: orgData.plan_id,
          plan_type: orgData.plan_type
        });
          setOrganisation(orgData);
      }

      setRoleError(null);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error fetching profile';
      console.error('[AuthContext] ❌ Exception in fetchUserRole:', error);
      setRoleError(errorMsg);
      setUserRole(null);
      setUserPlan(null);
      setDisciplineType(null);
      setBoltOns([]);
      setMaxEditors(999);
      setActiveEditors(1);
      setIsPlatformAdmin(false);
      setCanEdit(false);
      setOrganisation(null);
      setHasAcceptedCurrentDisclaimer(false);
      setDisclaimerAcceptedAt(null);
    } finally {
      setLoading(false);
    }
  };

  const refreshUserRole = async () => {
    if (user) {
      setLoading(true);
      await fetchUserRole(user.id, user.email || '', user);
    }
  };

  useEffect(() => {
    console.log('[AuthContext] Initializing auth state...');

    let isMounted = true;

    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (error) {
          console.error('[AuthContext] Error getting session:', error);
          setLoading(false);
          setAuthInitialized(true);
          return;
        }

        console.log('[AuthContext] Initial session:', session?.user?.email || 'No user');

        if (session?.user) {
          // Don't set user yet - fetchUserRole will set it with merged profile data
          // fetchUserRole will setLoading(false) in finally
          await fetchUserRole(session.user.id, session.user.email || '', session.user);
        } else {
          setUser(null);
          setUserRole(null);
          setUserPlan(null);
          setDisciplineType(null);
          setBoltOns([]);
          setMaxEditors(999);
          setActiveEditors(1);
          setIsPlatformAdmin(false);
          setCanEdit(false);
          setOrganisation(null);
          setRoleError(null);
          setLoading(false);
        }

        setAuthInitialized(true);
      } catch (error) {
        console.error('[AuthContext] Exception during auth init:', error);
        if (isMounted) {
          setLoading(false);
          setAuthInitialized(true);
        }
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] Auth state changed:', event, session?.user?.email || 'No user');

      if (!isMounted) return;

      // Prevent duplicate fetch on initial page load.
      // initAuth() already handles session restore.
      if (event === 'INITIAL_SESSION') return;

      (async () => {
        if (session?.user) {
          // Only refetch profile on real auth changes
          if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
            setLoading(true);
            // Don't set user yet - fetchUserRole will set it with merged profile data
            await fetchUserRole(session.user.id, session.user.email || '', session.user);
          }
          // For TOKEN_REFRESHED and other events, don't refetch - avoid UI flicker
        } else {
          setUser(null);
          console.log('[AuthContext] Clearing profile state on sign out');
          setUserRole(null);
          setUserPlan(null);
          setDisciplineType(null);
          setBoltOns([]);
          setMaxEditors(999);
          setActiveEditors(1);
          setIsPlatformAdmin(false);
          setCanEdit(false);
          setOrganisation(null);
          setRoleError(null);
          setHasAcceptedCurrentDisclaimer(false);
          setDisclaimerAcceptedAt(null);
          setLoading(false);
        }
      })();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error };
  };

  return (
    <AuthContext.Provider value={{
      user,
      userRole,
      userPlan,
      disciplineType,
      boltOns,
      maxEditors,
      activeEditors,
      isPlatformAdmin,
      canEdit,
      organisation,
      roleError,
      hasAcceptedCurrentDisclaimer,
      disclaimerAcceptedAt,
      loading,
      authInitialized,
      signIn,
      signUp,
      signOut,
      resetPassword,
      refreshUserRole
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
