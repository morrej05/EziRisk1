import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Trash2, Shield, Edit2, X, Check, AlertTriangle, Mail, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { UserRole, ROLE_LABELS, ROLE_DESCRIPTIONS } from '../utils/permissions';
import UpgradeBlockModal from './UpgradeBlockModal';
import {
  getUserSeatEntitlement,
  getUserSeatLimitCopy,
  type UserSeatEntitlement,
} from '../utils/userSeatEntitlements';
import { inferUserUpgradeReason, type UpgradeBlockReason } from '../utils/upgradeBlocks';
import { buildUpgradePath } from '../utils/upgradeNavigation';
import { getUserLimitForOrganisation } from '../utils/planLimits';

// organisation_members.role stores 'consultant'; the app surface uses 'surveyor'.
function toDbRole(role: UserRole): string {
  return role === 'surveyor' ? 'consultant' : role;
}

function fromDbRole(dbRole: string): UserRole {
  if (dbRole === 'consultant') return 'surveyor';
  if (dbRole === 'admin' || dbRole === 'viewer') return dbRole;
  return 'viewer';
}

/**
 * Supabase FunctionsHttpError stores the raw Response in `.context`.
 * Read it to get the actual JSON error message rather than the generic
 * "Edge Function returned a non-2xx status code" wrapper.
 */
async function extractEdgeFunctionError(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') {
    return 'An unexpected error occurred. Please try again.';
  }
  const maybeResp = (error as Record<string, unknown>).context;
  if (maybeResp instanceof Response) {
    try {
      const body = (await maybeResp.json()) as Record<string, unknown>;
      if (typeof body.error === 'string' && body.error) return body.error;
    } catch {
      // body was not JSON or was already consumed — fall through
    }
  }
  if (error instanceof Error && error.message) return error.message;
  const msg = (error as Record<string, unknown>).message;
  if (typeof msg === 'string' && msg) return msg;
  return 'An unexpected error occurred. Please try again.';
}

interface UserProfile {
  id: string;
  role: UserRole;
  name: string | null;
  email?: string;
  created_at: string;
  is_platform_admin: boolean;
}

interface PendingInvite {
  id: string;
  user_id: string;
  invited_email: string;
  /** Name from user_profiles if the trigger already created the row; null if not yet. */
  name: string | null;
  role: UserRole;
  created_at: string;
  invited_at: string | null;
}

interface OrganisationMemberRow {
  user_id: string;
  role: UserRole;
  status: string;
  created_at: string;
  invited_email: string | null;
  joined_at: string | null;
}

interface UserProfileRow {
  id: string;
  name: string | null;
  created_at: string;
  is_platform_admin: boolean | null;
}

export default function UserManagement() {
  const { user: currentUser, isPlatformAdmin, organisation } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('viewer');
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [addSuccessMessage, setAddSuccessMessage] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<UserRole>('viewer');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seatEntitlement, setSeatEntitlement] = useState<UserSeatEntitlement | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<UpgradeBlockReason>('user_limit');
  const [upgradeDetail, setUpgradeDetail] = useState<string | null>(null);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  const maxUsers = useMemo(() => getUserLimitForOrganisation(organisation), [organisation]);
  const currentUsers = users.length;
  const atSeatLimit = useMemo(() => currentUsers >= maxUsers, [currentUsers, maxUsers]);
  const isNearSeatLimit = useMemo(
    () => !atSeatLimit && maxUsers > 0 && currentUsers / maxUsers >= 0.8,
    [atSeatLimit, currentUsers, maxUsers],
  );
  const seatLimitCopy = useMemo(
    () => getUserSeatLimitCopy(seatEntitlement, organisation),
    [seatEntitlement, organisation],
  );
  const isTrialExpired = useMemo(() => {
    const message = (seatEntitlement?.reason || '').toLowerCase();
    return message.includes('trial') && message.includes('expired');
  }, [seatEntitlement?.reason]);

  // Derived: is the current modal error a "duplicate pending invite" error?
  const isDuplicateInviteError = Boolean(
    modalError?.toLowerCase().includes('already been sent'),
  );
  // Derived: is the user already an active member of this org?
  const isAlreadyActiveMemberError = Boolean(
    modalError?.toLowerCase().includes('already an active member'),
  );

  const refreshSeatEntitlement = async () => {
    if (!currentUser?.organisation_id) { setSeatEntitlement(null); return; }
    const entitlement = await getUserSeatEntitlement(currentUser.organisation_id);
    setSeatEntitlement(entitlement);
  };

  useEffect(() => {
    void fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.organisation_id]);

  const openAddModal = () => {
    setShowAddModal(true);
    setModalError(null);
    setAddSuccessMessage(null);
    setActionError(null);
  };

  const closeAddModal = () => {
    if (isAddingUser) return; // prevent closing mid-submit
    setShowAddModal(false);
    setModalError(null);
  };

  const fetchUsers = async () => {
    if (!currentUser?.organisation_id) {
      setUsers([]);
      setPendingInvites([]);
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const [memberResult, inviteResult] = await Promise.all([
        supabase
          .from('organisation_members')
          .select('user_id, role, status, created_at, invited_email, joined_at')
          .eq('organisation_id', currentUser.organisation_id)
          .eq('status', 'active')
          .order('created_at', { ascending: true }),
        supabase
          .from('organisation_members')
          .select('id, user_id, invited_email, role, created_at, invited_at')
          .eq('organisation_id', currentUser.organisation_id)
          .eq('status', 'invited')
          .order('created_at', { ascending: false }),
      ]);

      if (memberResult.error) {
        console.error('[UserManagement] Failed organisation_members query', memberResult.error);
        throw memberResult.error;
      }

      // ── Active members ────────────────────────────────────────────────────
      const activeMembers = (memberResult.data ?? []) as OrganisationMemberRow[];
      const memberIds = activeMembers.map((m) => m.user_id);

      let profilesById = new Map<string, UserProfileRow>();
      if (memberIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('id, name, created_at, is_platform_admin')
          .in('id', memberIds);

        if (profileError) {
          console.error('[UserManagement] Failed user_profiles query', profileError);
          throw profileError;
        }
        profilesById = new Map(
          ((profileData ?? []) as UserProfileRow[]).map((p) => [p.id, p]),
        );
      }

      const usersWithMembershipRole: UserProfile[] = activeMembers.map((member) => {
        const profile = profilesById.get(member.user_id);
        return {
          id: member.user_id,
          role: fromDbRole(member.role as unknown as string),
          name: profile?.name ?? null,
          // For the current user use the live session email; for others fall
          // back to invited_email stored on the membership row (always present
          // for users who joined via invite).
          email: member.user_id === currentUser.id
            ? currentUser.email ?? undefined
            : member.invited_email ?? undefined,
          // Prefer the actual join timestamp; fall back to profile/member created_at.
          created_at: member.joined_at ?? profile?.created_at ?? member.created_at,
          is_platform_admin: Boolean(profile?.is_platform_admin),
        };
      });

      if (!usersWithMembershipRole.some((m) => m.id === currentUser.id)) {
        const { data: selfProfile } = await supabase
          .from('user_profiles')
          .select('id, name, created_at, is_platform_admin')
          .eq('id', currentUser.id)
          .maybeSingle();
        usersWithMembershipRole.push({
          id: currentUser.id,
          role: currentUser.role ?? 'viewer',
          name: selfProfile?.name ?? currentUser.user_metadata?.name ?? null,
          email: currentUser.email ?? undefined,
          created_at: selfProfile?.created_at ?? new Date().toISOString(),
          is_platform_admin: Boolean(selfProfile?.is_platform_admin ?? isPlatformAdmin),
        });
      }

      setUsers(usersWithMembershipRole);

      // ── Pending invites ───────────────────────────────────────────────────
      // Non-fatal if RLS denies (non-admin viewers) or the column is absent.
      // On error: keep whatever state we have (could be optimistic rows from a
      // just-sent invite) rather than wiping it.  The erroneous clearing was the
      // primary reason invited users disappeared immediately after the success
      // banner appeared.
      if (inviteResult.error) {
        console.warn('[UserManagement] Pending invites query failed (RLS or schema issue):', inviteResult.error);
        // Intentionally do NOT call setPendingInvites here — keep existing state.
      } else {
        const inviteRows = inviteResult.data ?? [];

        // Fetch display names from user_profiles for invited user IDs.
        // The handle_new_user() trigger creates a user_profiles row with the
        // name passed in the invite metadata, so this data is available
        // immediately after the invite is sent.
        const inviteUserIds = inviteRows.map((r) => r.user_id as string).filter(Boolean);
        const inviteNameById = new Map<string, string | null>();

        if (inviteUserIds.length > 0) {
          const { data: inviteProfiles } = await supabase
            .from('user_profiles')
            .select('id, name')
            .in('id', inviteUserIds);

          for (const p of (inviteProfiles ?? []) as { id: string; name: string | null }[]) {
            inviteNameById.set(p.id, p.name ?? null);
          }
        }

        setPendingInvites(
          inviteRows.map((row) => ({
            id: row.id as string,
            user_id: row.user_id as string,
            invited_email: (row.invited_email as string | null) ?? '',
            name: inviteNameById.get(row.user_id as string) ?? null,
            role: fromDbRole(row.role as string),
            created_at: row.created_at as string,
            invited_at: row.invited_at as string | null,
          })),
        );
      }

      await refreshSeatEntitlement();
    } catch (error: unknown) {
      console.error('[UserManagement] Error fetching users', error);
      setLoadError('Failed to load users. Please try again.');
      setUsers([]);
      setPendingInvites([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Invite ───────────────────────────────────────────────────────────────

  const handleInviteUser = async () => {
    if (!newUserEmail.trim() || isAddingUser) return;

    if (!currentUser?.organisation_id) {
      setModalError('Cannot invite users without an organisation context.');
      return;
    }

    setIsAddingUser(true);
    setModalError(null);
    try {
      const entitlement = await getUserSeatEntitlement(currentUser.organisation_id);
      setSeatEntitlement(entitlement);

      if (!entitlement.allowed) {
        const blockedReason = entitlement.reason?.toLowerCase().includes('trial')
          ? 'trial_expired'
          : inferUserUpgradeReason();
        setUpgradeReason(blockedReason);
        setUpgradeDetail(
          blockedReason === 'trial_expired'
            ? (entitlement.reason ?? 'Your free trial has ended. Upgrade to add team members.')
            : getUserSeatLimitCopy(entitlement, organisation).body,
        );
        setShowUpgradeModal(true);
        return;
      }

      const sentEmail = newUserEmail.trim();
      const sentName = newUserName.trim();
      const sentRole = newUserRole;

      const { data: inviteResponseData, error } = await supabase.functions.invoke('invite-org-member', {
        body: {
          organisation_id: currentUser.organisation_id,
          email: sentEmail,
          role: toDbRole(sentRole),
          ...(sentName ? { name: sentName } : {}),
        },
      });

      if (error) {
        const message = await extractEdgeFunctionError(error);
        const lower = message.toLowerCase();
        if (lower.includes('seat limit') || lower.includes('upgrade') || lower.includes('plan')) {
          setUpgradeReason(lower.includes('trial') ? 'trial_expired' : inferUserUpgradeReason());
          setUpgradeDetail(message);
          setShowUpgradeModal(true);
        } else {
          setModalError(message);
        }
        return;
      }

      // Success — close modal, reset form, show page-level banner.
      setShowAddModal(false);
      setModalError(null);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('viewer');
      setAddSuccessMessage(
        `Invite sent to ${sentEmail}. They'll receive an email with a link to join your organisation.`,
      );

      // Optimistically add the new invite row immediately so it's visible
      // without waiting for the background refresh.  The real row (with the
      // DB-generated id) will replace this once fetchUsers() completes.
      const responseData = (inviteResponseData ?? {}) as { user_id?: string };
      const optimisticInvite: PendingInvite = {
        id: `optimistic-${Date.now()}`,
        user_id: responseData.user_id ?? '',
        invited_email: sentEmail,
        name: sentName || null,
        role: sentRole,
        created_at: new Date().toISOString(),
        invited_at: new Date().toISOString(),
      };
      setPendingInvites((prev) => [optimisticInvite, ...prev]);

      // Refresh in the background to get the canonical DB row.
      void fetchUsers();
    } catch (error: unknown) {
      const message = await extractEdgeFunctionError(error);
      setModalError(message);
    } finally {
      setIsAddingUser(false);
    }
  };

  // ── Resend / Revoke ──────────────────────────────────────────────────────

  /**
   * Canonical resend handler.  Both call sites (modal CTA and pending-table
   * Resend button) funnel through here with just an email address.
   *
   * Using email as the lookup key mirrors the duplicate-detection query in
   * invite-org-member so both paths share a single source of truth
   * (organisation_members.invited_email) and neither depends on React state
   * being populated.
   */
  const handleResendByEmail = async (email: string) => {
    const normalisedEmail = email.trim().toLowerCase();
    setResendingUserId(normalisedEmail);
    setActionError(null);
    try {
      const { data: resendData, error } = await supabase.functions.invoke('resend-invite', {
        body: { organisation_id: currentUser?.organisation_id, email: normalisedEmail },
      });

      if (error) {
        const message = await extractEdgeFunctionError(error);
        setActionError(`Failed to resend invite: ${message}`);
        return;
      }

      // Optimistically stamp the new invited_at on any matching row.
      const newInvitedAt =
        (resendData as { invited_at?: string } | null)?.invited_at ?? new Date().toISOString();

      setPendingInvites((prev) =>
        prev.map((i) =>
          i.invited_email.toLowerCase() === normalisedEmail
            ? { ...i, invited_at: newInvitedAt }
            : i,
        ),
      );

      setAddSuccessMessage(`Invite resent to ${normalisedEmail}.`);
      void fetchUsers();
    } catch (err: unknown) {
      const message = await extractEdgeFunctionError(err);
      setActionError(`Failed to resend invite: ${message}`);
    } finally {
      setResendingUserId(null);
    }
  };

  /** Thin wrapper so the pending-invites table can pass a PendingInvite object. */
  const handleResendInvite = (invite: PendingInvite) =>
    handleResendByEmail(invite.invited_email);

  /**
   * Called from the "Resend invite" button in the duplicate-error banner.
   * Uses the email typed in the modal directly — no pendingInvites lookup
   * needed, so there is no race condition with fetchUsers().
   */
  const handleResendFromModal = () => {
    setShowAddModal(false);
    setModalError(null);
    void handleResendByEmail(newUserEmail.trim());
  };

  const handleRevokeInvite = async (invite: PendingInvite) => {
    if (
      !confirm(
        `Revoke the invite for ${invite.invited_email}? They won't be able to join using the current invite link.`,
      )
    ) return;
    setRevokingUserId(invite.user_id);
    setActionError(null);
    try {
      const { error } = await supabase.functions.invoke('revoke-invite', {
        body: { organisation_id: currentUser?.organisation_id, user_id: invite.user_id },
      });
      if (error) throw error;
      await fetchUsers();
    } catch (error: unknown) {
      const message = await extractEdgeFunctionError(error);
      setActionError(`Failed to revoke invite: ${message}`);
    } finally {
      setRevokingUserId(null);
    }
  };

  // ── Active member actions ────────────────────────────────────────────────

  const handleUpdateRole = async (userId: string, newRole: UserRole) => {
    const adminCount = users.filter((u) => u.role === 'admin').length;
    const target = users.find((u) => u.id === userId);
    const isDemotingAdmin = target?.role === 'admin' && newRole !== 'admin';

    if (adminCount === 1 && isDemotingAdmin) {
      alert('Cannot change role: at least one admin must remain in the organisation.');
      setEditingUserId(null);
      return;
    }

    try {
      const { error } = await supabase
        .from('organisation_members')
        .update({ role: toDbRole(newRole) })
        .eq('organisation_id', currentUser?.organisation_id)
        .eq('user_id', userId)
        .eq('status', 'active');
      if (error) throw error;
      setUsers(users.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
      setEditingUserId(null);
    } catch (error) {
      console.error('Error updating role:', error);
      alert('Failed to update user role. Please try again.');
    }
  };

  const handleTogglePlatformAdmin = async (userId: string, currentValue: boolean) => {
    if (users.filter((u) => u.is_platform_admin).length === 1 && currentValue) {
      alert('At least one Platform Admin is required. Cannot remove the last Platform Admin.');
      return;
    }
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_platform_admin: !currentValue })
        .eq('id', userId);
      if (error) throw error;
      setUsers(users.map((u) => (u.id === userId ? { ...u, is_platform_admin: !currentValue } : u)));
    } catch (error) {
      console.error('Error updating platform admin status:', error);
      alert('Failed to update Platform Admin status. Please try again.');
    }
  };

  const handleRemoveUser = async (userId: string, userName?: string) => {
    const adminCount = users.filter((u) => u.role === 'admin').length;
    const target = users.find((u) => u.id === userId);
    if (adminCount === 1 && target?.role === 'admin') {
      alert('Cannot remove user: at least one admin must remain in the organisation.');
      return;
    }
    if (!confirm(`Remove ${userName || 'this user'} from your organisation? They will lose access immediately.`)) return;
    try {
      const { error } = await supabase.functions.invoke('remove-org-member', {
        body: { organisation_id: currentUser?.organisation_id, target_user_id: userId },
      });
      if (error) throw error;
      await fetchUsers();
    } catch (error) {
      console.error('[UserManagement] Error removing user:', error);
      alert(`Failed to remove user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getRoleBadgeColor = (role: UserRole) => {
    if (role === 'admin') return 'bg-red-100 text-red-700 border-red-300';
    if (role === 'surveyor') return 'bg-blue-100 text-blue-700 border-blue-300';
    return 'bg-slate-100 text-slate-700 border-slate-300';
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const inviteDisplayName = (invite: PendingInvite): string | null => {
    const n = invite.name?.trim();
    // Only show name if it doesn't look like an email — the trigger seeds the
    // name from the invite metadata; if no name was provided it falls back to
    // the email address, which isn't useful as a display name here.
    if (n && !n.includes('@')) return n;
    return null;
  };

  // ── Loading state ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-300 border-t-slate-900" />
        <span className="ml-3 text-slate-600">Loading users...</span>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {/* ── Banners ── */}
      {isNearSeatLimit && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-semibold">You're close to your seat limit ({currentUsers} of {maxUsers} users).</p>
        </div>
      )}
      {atSeatLimit && (
        <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                {isTrialExpired
                  ? 'Your free trial has ended. Upgrade to add team members.'
                  : `You've reached your user limit (${maxUsers}). Upgrade to add more.`}
              </p>
              <p className="mt-0.5">{isTrialExpired ? 'Existing data is still available.' : seatLimitCopy.body}</p>
              <button
                onClick={() =>
                  window.location.assign(
                    buildUpgradePath(isTrialExpired ? 'trial_expired' : 'user_limit', { action: 'manage_users' }),
                  )
                }
                className="mt-2 inline-flex rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 transition-colors"
              >
                Upgrade
              </button>
            </div>
          </div>
        </div>
      )}
      {loadError && (
        <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{loadError}</div>
      )}
      {actionError && (
        <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start justify-between gap-2">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 text-red-600 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {addSuccessMessage && (
        <div className="mx-4 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p>{addSuccessMessage}</p>
          </div>
          <button onClick={() => setAddSuccessMessage(null)} className="shrink-0 text-emerald-600 hover:text-emerald-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="px-4 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Users className="w-5 h-5 text-slate-600 shrink-0" />
          <h2 className="text-base sm:text-lg font-semibold text-slate-900 truncate">User Management</h2>
          <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 rounded shrink-0">
            {currentUsers}/{maxUsers} seats
          </span>
        </div>
        <button
          onClick={openAddModal}
          disabled={atSeatLimit || isTrialExpired}
          title={isTrialExpired ? 'Upgrade to add team members.' : atSeatLimit ? seatLimitCopy.body : 'Invite a user'}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Invite User
        </button>
      </div>

      {/* ── Active users — desktop table ── */}
      {/* overflow-x-auto lets the table scroll horizontally if needed without
          breaking the card layout; min-w-[600px] ensures columns don't collapse. */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-[200px]">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-[150px]">Role</th>
              {isPlatformAdmin && (
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-[130px]">Platform Admin</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-[100px] whitespace-nowrap">Joined</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider w-[100px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-4 w-[200px]">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 shrink-0 rounded-full bg-slate-200 flex items-center justify-center">
                      <span className="text-sm font-medium text-slate-600">
                        {(user.name || user.email || 'U').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="truncate text-sm font-medium text-slate-900">{user.name || 'Unnamed User'}</span>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-slate-600 max-w-0">
                  <span className="block truncate">{user.email || '—'}</span>
                </td>
                <td className="px-4 py-4 w-[150px]">
                  {editingUserId === user.id ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={editingRole}
                        onChange={(e) => setEditingRole(e.target.value as UserRole)}
                        className="text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="surveyor">Surveyor</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button onClick={() => handleUpdateRole(user.id, editingRole)} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Save">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingUserId(null)} className="p-1 text-slate-600 hover:bg-slate-100 rounded" title="Cancel">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-semibold ${getRoleBadgeColor(user.role)}`}>
                        <Shield className="w-3 h-3" />{ROLE_LABELS[user.role]}
                      </span>
                      <button
                        onClick={() => { setEditingUserId(user.id); setEditingRole(user.role); }}
                        className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                        title="Edit role"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </td>
                {isPlatformAdmin && (
                  <td className="px-4 py-4 w-[130px]">
                    {user.role === 'admin' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={user.is_platform_admin}
                          onChange={() => handleTogglePlatformAdmin(user.id, user.is_platform_admin)}
                          className="w-4 h-4 text-slate-900 border-slate-300 rounded"
                        />
                        <span className="text-sm text-slate-700">{user.is_platform_admin ? 'Yes' : 'No'}</span>
                      </label>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-4 text-sm text-slate-600 whitespace-nowrap w-[100px]">{formatDate(user.created_at)}</td>
                <td className="px-4 py-4 text-right w-[100px]">
                  <button
                    onClick={() => handleRemoveUser(user.id, user.name || undefined)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Active users — mobile cards ── */}
      <div className="sm:hidden divide-y divide-slate-200">
        {users.map((user) => (
          <div key={user.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              {/* Left: avatar + info */}
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 shrink-0 rounded-full bg-slate-200 flex items-center justify-center">
                  <span className="text-sm font-medium text-slate-600">
                    {(user.name || user.email || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{user.name || 'Unnamed User'}</p>
                  {user.email && <p className="text-xs text-slate-500 truncate">{user.email}</p>}
                  <p className="text-xs text-slate-400 mt-0.5">Joined {formatDate(user.created_at)}</p>
                </div>
              </div>
              {/* Right: role badge + action icons */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                {editingUserId !== user.id && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold ${getRoleBadgeColor(user.role)}`}>
                    <Shield className="w-3 h-3" />{ROLE_LABELS[user.role]}
                  </span>
                )}
                {editingUserId === user.id ? (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={editingRole}
                      onChange={(e) => setEditingRole(e.target.value as UserRole)}
                      className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-500"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="surveyor">Surveyor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={() => handleUpdateRole(user.id, editingRole)} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="Save">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingUserId(null)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded" title="Cancel">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingUserId(user.id); setEditingRole(user.role); }}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                      title="Edit role"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRemoveUser(user.id, user.name || undefined)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {users.length === 0 && (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 mb-2">No users yet</p>
          <p className="text-sm text-slate-500">Invite your first team member to get started</p>
        </div>
      )}

      {/* ── Pending invitations ── */}
      {pendingInvites.length > 0 && (
        <div className="border-t border-slate-200">
          {/* Section header */}
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-700">
                Pending Invitations
                <span className="ml-2 px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                  {pendingInvites.length}
                </span>
              </h3>
            </div>
          </div>

          {/* Inline action error — shown here so it's visible when scrolled to this section */}
          {actionError && (
            <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{actionError}</span>
              </div>
              <button onClick={() => setActionError(null)} className="shrink-0 text-red-500 hover:text-red-700 ml-1">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Desktop rows */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full">
              <colgroup>
                {/* Name/avatar */}
                <col className="w-[220px]" />
                {/* Email */}
                <col />
                {/* Role */}
                <col className="w-[140px]" />
                {/* Invited date */}
                <col className="w-[110px]" />
                {/* Actions */}
                <col className="w-[130px]" />
              </colgroup>
              <tbody className="divide-y divide-slate-100">
                {pendingInvites.map((invite) => {
                  const displayName = inviteDisplayName(invite);
                  const isResending = resendingUserId === invite.invited_email.toLowerCase();
                  const isRevoking = revokingUserId === invite.user_id;
                  return (
                    <tr key={invite.id} className="hover:bg-amber-50/40 transition-colors">
                      {/* Name / avatar */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 shrink-0 rounded-full bg-amber-100 flex items-center justify-center">
                            <span className="text-sm font-medium text-amber-700">
                              {(displayName || invite.invited_email || 'I').charAt(0).toUpperCase()}
                            </span>
                          </div>
                          {displayName ? (
                            <span className="text-sm font-medium text-slate-700 truncate">{displayName}</span>
                          ) : (
                            <span className="text-sm text-slate-400 italic">Awaiting signup</span>
                          )}
                        </div>
                      </td>
                      {/* Email */}
                      <td className="px-4 py-3 text-sm text-slate-600 max-w-0">
                        <span className="block truncate">{invite.invited_email}</span>
                      </td>
                      {/* Role */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-semibold ${getRoleBadgeColor(invite.role)}`}>
                          <Shield className="w-3 h-3" />{ROLE_LABELS[invite.role]}
                        </span>
                      </td>
                      {/* Invited date */}
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatDate(invite.invited_at ?? invite.created_at)}
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleResendInvite(invite)}
                            disabled={isResending || isRevoking}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-40"
                            title="Resend invite"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
                            {isResending ? 'Sending…' : 'Resend'}
                          </button>
                          <button
                            onClick={() => handleRevokeInvite(invite)}
                            disabled={isResending || isRevoking}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-40"
                            title="Revoke invite"
                          >
                            <X className="w-3.5 h-3.5" />Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile invite cards */}
          <div className="sm:hidden divide-y divide-slate-100">
            {pendingInvites.map((invite) => {
              const displayName = inviteDisplayName(invite);
              const isResending = resendingUserId === invite.invited_email.toLowerCase();
              const isRevoking = revokingUserId === invite.user_id;
              return (
                <div key={invite.id} className="px-4 py-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Avatar */}
                    <div className="h-9 w-9 shrink-0 rounded-full bg-amber-100 flex items-center justify-center">
                      <span className="text-sm font-medium text-amber-700">
                        {(displayName || invite.invited_email || 'I').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    {/* Info + actions */}
                    <div className="min-w-0 flex-1">
                      {/* Top row: name/email + action icons */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {displayName ? (
                            <>
                              <p className="text-sm font-medium text-slate-800 truncate">{displayName}</p>
                              <p className="text-xs text-slate-500 truncate">{invite.invited_email}</p>
                            </>
                          ) : (
                            <p className="text-sm font-medium text-slate-700 truncate">{invite.invited_email}</p>
                          )}
                        </div>
                        {/* Icon-only action buttons on mobile */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleResendInvite(invite)}
                            disabled={isResending || isRevoking}
                            className="p-1.5 text-slate-500 hover:bg-slate-100 rounded disabled:opacity-40"
                            title="Resend invite"
                          >
                            <RotateCcw className={`w-4 h-4 ${isResending ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleRevokeInvite(invite)}
                            disabled={isResending || isRevoking}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                            title="Revoke invite"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {/* Bottom row: role badge + date */}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold ${getRoleBadgeColor(invite.role)}`}>
                          <Shield className="w-3 h-3" />{ROLE_LABELS[invite.role]}
                        </span>
                        <span className="text-xs text-slate-400">
                          Invited {formatDate(invite.invited_at ?? invite.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Invite User modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Invite User</h3>
              <button onClick={closeAddModal} disabled={isAddingUser} className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                An invitation email will be sent. The recipient clicks the link to create their account and join your organisation automatically.
              </p>

              {/* Inline modal error — with optional Resend shortcut */}
              {modalError && (
                <div className={`rounded-md border px-3 py-2.5 text-sm ${isAlreadyActiveMemberError ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${isAlreadyActiveMemberError ? 'text-blue-600' : 'text-red-600'}`} />
                    <div className="flex-1 min-w-0">
                      <p>{isAlreadyActiveMemberError ? `${newUserEmail.trim()} already belongs to this organisation.` : modalError}</p>
                      {isDuplicateInviteError && (
                        <button
                          onClick={handleResendFromModal}
                          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-900 transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Resend invite to {newUserEmail.trim()}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => { setNewUserEmail(e.target.value); setModalError(null); }}
                  placeholder="user@example.com"
                  autoComplete="off"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-900 text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-900 text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Role <span className="text-red-500">*</span>
                </label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-900 text-base"
                >
                  <option value="viewer">Viewer — read-only access</option>
                  <option value="surveyor">Surveyor — create and edit surveys</option>
                  <option value="admin">Admin — full access</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">{ROLE_DESCRIPTIONS[newUserRole]}</p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                onClick={closeAddModal}
                disabled={isAddingUser}
                className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleInviteUser}
                disabled={isAddingUser || atSeatLimit || isTrialExpired || !newUserEmail.trim()}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAddingUser ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Send Invite
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <UpgradeBlockModal
        open={showUpgradeModal}
        reason={upgradeReason}
        detail={upgradeDetail}
        onClose={() => setShowUpgradeModal(false)}
        onUpgrade={() => window.location.assign(buildUpgradePath(upgradeReason, { action: 'add_user' }))}
      />
    </div>
  );
}
