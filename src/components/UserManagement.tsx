import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Trash2, Shield, Edit2, X, Check, AlertTriangle, Mail, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { UserRole, ROLE_LABELS, ROLE_DESCRIPTIONS } from '../utils/permissions';
import UpgradeBlockModal from './UpgradeBlockModal';
import {
  getUserSeatEntitlement,
  getUserSeatLimitCopy,
  normalizeSeatLimitErrorMessage,
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
  role: UserRole;
  created_at: string;
  invited_at: string | null;
}

interface OrganisationMemberRow {
  user_id: string;
  role: UserRole;
  status: string;
  created_at: string;
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

  const refreshSeatEntitlement = async () => {
    if (!currentUser?.organisation_id) {
      setSeatEntitlement(null);
      return;
    }

    const entitlement = await getUserSeatEntitlement(currentUser.organisation_id);
    setSeatEntitlement(entitlement);
  };

  useEffect(() => {
    void fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.organisation_id]);

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
          .select('user_id, role, status, created_at')
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

      const activeMembers = (memberResult.data ?? []) as OrganisationMemberRow[];
      const memberIds = activeMembers.map((member) => member.user_id);

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
          ((profileData ?? []) as UserProfileRow[]).map((profile) => [profile.id, profile]),
        );
      }

      const usersWithMembershipRole: UserProfile[] = activeMembers.map((member) => {
        const profile = profilesById.get(member.user_id);
        return {
          id: member.user_id,
          role: fromDbRole(member.role),
          name: profile?.name ?? null,
          email: member.user_id === currentUser.id ? currentUser.email ?? undefined : undefined,
          created_at: profile?.created_at ?? member.created_at,
          is_platform_admin: Boolean(profile?.is_platform_admin),
        };
      });

      if (!usersWithMembershipRole.some((member) => member.id === currentUser.id)) {
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

      // Pending invites — non-fatal if RLS denies (non-admin users won't see them)
      if (!inviteResult.error && inviteResult.data) {
        setPendingInvites(
          inviteResult.data.map((row) => ({
            id: row.id as string,
            user_id: row.user_id as string,
            invited_email: (row.invited_email as string | null) ?? '',
            role: fromDbRole(row.role as string),
            created_at: row.created_at as string,
            invited_at: row.invited_at as string | null,
          })),
        );
      } else {
        setPendingInvites([]);
      }

      await refreshSeatEntitlement();
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'message' in error) {
        console.error('[UserManagement] Error fetching users', error);
      } else {
        console.error('[UserManagement] Error fetching users', error);
      }
      setLoadError('Failed to load users. Please try again.');
      setUsers([]);
      setPendingInvites([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInviteUser = async () => {
    if (!newUserEmail.trim()) return;

    if (!currentUser?.organisation_id) {
      setActionError('Cannot invite users without an organisation context.');
      return;
    }

    setIsAddingUser(true);
    setActionError(null);
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

      const { error } = await supabase.functions.invoke('invite-org-member', {
        body: {
          organisation_id: currentUser.organisation_id,
          email: newUserEmail.trim(),
          role: toDbRole(newUserRole),
          ...(newUserName.trim() ? { name: newUserName.trim() } : {}),
        },
      });

      if (error) throw error;

      setShowAddModal(false);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('viewer');
      setAddSuccessMessage(
        `Invite sent to ${newUserEmail.trim()}. They'll receive an email with a link to join your organisation.`,
      );
      await fetchUsers();
    } catch (error: unknown) {
      const message = normalizeSeatLimitErrorMessage(error);
      if (
        message.toLowerCase().includes('seat limit') ||
        message.toLowerCase().includes('upgrade') ||
        message.toLowerCase().includes('trial')
      ) {
        setUpgradeReason(message.toLowerCase().includes('trial') ? 'trial_expired' : inferUserUpgradeReason());
        setUpgradeDetail(message);
        setShowUpgradeModal(true);
      } else {
        setActionError(message || 'Could not send invite. Please try again.');
      }
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleResendInvite = async (invite: PendingInvite) => {
    setResendingUserId(invite.user_id);
    setActionError(null);
    try {
      const { error } = await supabase.functions.invoke('resend-invite', {
        body: {
          organisation_id: currentUser?.organisation_id,
          user_id: invite.user_id,
        },
      });
      if (error) throw error;
      setAddSuccessMessage(`Invite resent to ${invite.invited_email}.`);
      await fetchUsers();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(`Failed to resend invite: ${message}`);
    } finally {
      setResendingUserId(null);
    }
  };

  const handleRevokeInvite = async (invite: PendingInvite) => {
    if (!confirm(`Revoke the invite for ${invite.invited_email}? They won't be able to join using the current invite link.`)) {
      return;
    }
    setRevokingUserId(invite.user_id);
    setActionError(null);
    try {
      const { error } = await supabase.functions.invoke('revoke-invite', {
        body: {
          organisation_id: currentUser?.organisation_id,
          user_id: invite.user_id,
        },
      });
      if (error) throw error;
      await fetchUsers();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(`Failed to revoke invite: ${message}`);
    } finally {
      setRevokingUserId(null);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: UserRole) => {
    const adminCount = users.filter(u => u.role === 'admin').length;
    const currentUserProfile = users.find(u => u.id === userId);
    const isCurrentUserAdmin = currentUserProfile?.role === 'admin';
    const isDemotingFromAdmin = isCurrentUserAdmin && newRole !== 'admin';

    if (adminCount === 1 && isDemotingFromAdmin) {
      alert('Cannot change role: At least one admin must remain in the system.');
      setEditingUserId(null);
      return;
    }

    if (userId === currentUser?.id && isDemotingFromAdmin && adminCount === 1) {
      alert('You cannot demote yourself as you are the only admin.');
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

      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      setEditingUserId(null);
    } catch (error) {
      console.error('Error updating role:', error);
      alert('Failed to update user role. Please try again.');
    }
  };

  const handleTogglePlatformAdmin = async (userId: string, currentValue: boolean) => {
    const platformAdminCount = users.filter(u => u.is_platform_admin).length;

    if (platformAdminCount === 1 && currentValue === true) {
      alert('At least one Platform Admin is required. Cannot remove the last Platform Admin.');
      return;
    }

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_platform_admin: !currentValue })
        .eq('id', userId);

      if (error) throw error;

      setUsers(users.map(u =>
        u.id === userId ? { ...u, is_platform_admin: !currentValue } : u
      ));
    } catch (error) {
      console.error('Error updating platform admin status:', error);
      alert('Failed to update Platform Admin status. Please try again.');
    }
  };

  const handleRemoveUser = async (userId: string, userName?: string) => {
    const adminCount = users.filter(u => u.role === 'admin').length;
    const userToRemove = users.find(u => u.id === userId);
    const isAdminUser = userToRemove?.role === 'admin';

    if (adminCount === 1 && isAdminUser) {
      alert('Cannot remove user: at least one admin must remain in the organisation.');
      return;
    }

    const displayLabel = userName || 'this user';
    if (!confirm(`Remove ${displayLabel} from your organisation? They will lose access immediately.`)) {
      return;
    }

    try {
      const { error } = await supabase.functions.invoke('remove-org-member', {
        body: {
          organisation_id: currentUser?.organisation_id,
          target_user_id: userId,
        },
      });
      if (error) throw error;
      await fetchUsers();
    } catch (error) {
      console.error('[UserManagement] Error removing user:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to remove user: ${message}`);
    }
  };

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-700 border-red-300';
      case 'surveyor': return 'bg-blue-100 text-blue-700 border-blue-300';
      case 'viewer': return 'bg-slate-100 text-slate-700 border-slate-300';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-300 border-t-slate-900"></div>
          <span className="ml-3 text-slate-600">Loading users...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
      {isNearSeatLimit && (
        <div className="mx-6 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <p className="font-semibold">You're close to your seat limit ({currentUsers} of {maxUsers} users).</p>
          </div>
        </div>
      )}

      {atSeatLimit && (
        <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              <p className="font-semibold">
                {isTrialExpired
                  ? 'Your free trial has ended. Upgrade to add team members.'
                  : `You've reached your user limit (${maxUsers}). Upgrade to add more team members.`}
              </p>
              <p>{isTrialExpired ? 'Existing data is still available.' : seatLimitCopy.body}</p>
              <button
                onClick={() => window.location.assign(buildUpgradePath(isTrialExpired ? 'trial_expired' : 'user_limit', { action: 'manage_users' }))}
                className="mt-2 inline-flex rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 transition-colors"
              >
                Upgrade
              </button>
            </div>
          </div>
        </div>
      )}

      {loadError && (
        <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {actionError && (
        <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start justify-between gap-2">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 text-red-600 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {addSuccessMessage && (
        <div className="mx-6 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p>{addSuccessMessage}</p>
          </div>
          <button
            onClick={() => setAddSuccessMessage(null)}
            className="shrink-0 text-emerald-600 hover:text-emerald-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">User Management</h2>
          <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 rounded">
            {`${currentUsers}/${maxUsers} seats`}
          </span>
        </div>
        <button
          onClick={() => { setShowAddModal(true); setAddSuccessMessage(null); setActionError(null); }}
          disabled={atSeatLimit || isTrialExpired}
          title={isTrialExpired ? 'Your free trial has ended. Upgrade to add team members.' : atSeatLimit ? seatLimitCopy.body : 'Invite a user'}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Invite User
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="w-[24%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">User</th>
              <th className="w-[26%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Email</th>
              <th className="w-[16%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Role</th>
              {isPlatformAdmin && (
                <th className="w-[14%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Platform Admin</th>
              )}
              <th className="w-[12%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">Joined</th>
              <th className="w-[12%] px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 shrink-0 rounded-full bg-slate-200 flex items-center justify-center">
                      <span className="text-sm font-medium text-slate-600">
                        {(user.name || user.email || 'U').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="truncate text-sm font-medium text-slate-900">
                      {user.name || 'Unnamed User'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-slate-600">
                  <span className="block truncate">{user.email || '—'}</span>
                </td>
                <td className="px-4 py-4">
                  {editingUserId === user.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={editingRole}
                        onChange={(e) => setEditingRole(e.target.value as UserRole)}
                        className="text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="surveyor">Surveyor</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button
                        onClick={() => handleUpdateRole(user.id, editingRole)}
                        className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                        title="Save"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingUserId(null)}
                        className="p-1 text-slate-600 hover:bg-slate-100 rounded transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-semibold ${getRoleBadgeColor(user.role)}`}>
                        <Shield className="w-3 h-3" />
                        {ROLE_LABELS[user.role]}
                      </span>
                      <button
                        onClick={() => { setEditingUserId(user.id); setEditingRole(user.role); }}
                        className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                        title="Edit role"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </td>
                {isPlatformAdmin && (
                  <td className="px-4 py-4">
                    {user.role === 'admin' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={user.is_platform_admin}
                          onChange={() => handleTogglePlatformAdmin(user.id, user.is_platform_admin)}
                          className="w-4 h-4 text-slate-900 border-slate-300 rounded focus:ring-2 focus:ring-slate-500"
                        />
                        <span className="text-sm text-slate-700">{user.is_platform_admin ? 'Yes' : 'No'}</span>
                      </label>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-4 text-sm text-slate-600 whitespace-nowrap">
                  {formatDate(user.created_at)}
                </td>
                <td className="px-4 py-4 text-right">
                  <button
                    onClick={() => handleRemoveUser(user.id, user.name || undefined)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Remove from organisation"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users.length === 0 && (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 mb-2">No users yet</p>
          <p className="text-sm text-slate-500">Invite your first team member to get started</p>
        </div>
      )}

      {pendingInvites.length > 0 && (
        <div className="border-t border-slate-200">
          <div className="px-6 py-3 bg-slate-50 flex items-center gap-2">
            <Mail className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">
              Pending Invitations
              <span className="ml-2 px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                {pendingInvites.length}
              </span>
            </h3>
          </div>
          <table className="w-full table-fixed">
            <tbody className="divide-y divide-slate-100">
              {pendingInvites.map((invite) => (
                <tr key={invite.id} className="hover:bg-slate-50 transition-colors">
                  <td className="w-[24%] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 shrink-0 rounded-full bg-amber-100 flex items-center justify-center">
                        <Mail className="h-4 w-4 text-amber-600" />
                      </div>
                      <span className="text-sm font-medium text-slate-500 italic">Awaiting signup</span>
                    </div>
                  </td>
                  <td className="w-[26%] px-4 py-3 text-sm text-slate-600">
                    <span className="block truncate">{invite.invited_email}</span>
                  </td>
                  <td className="w-[16%] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-semibold ${getRoleBadgeColor(invite.role)}`}>
                        <Shield className="w-3 h-3" />
                        {ROLE_LABELS[invite.role]}
                      </span>
                    </div>
                  </td>
                  {isPlatformAdmin && <td className="w-[14%] px-4 py-3" />}
                  <td className="w-[12%] px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    Invited {formatDate(invite.invited_at ?? invite.created_at)}
                  </td>
                  <td className="w-[12%] px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleResendInvite(invite)}
                        disabled={resendingUserId === invite.user_id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                        title="Resend invite email"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Resend
                      </button>
                      <button
                        onClick={() => handleRevokeInvite(invite)}
                        disabled={revokingUserId === invite.user_id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                        title="Revoke invite"
                      >
                        <X className="w-3.5 h-3.5" />
                        Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Invite User</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700 border border-slate-200">
                An invitation email will be sent. The recipient clicks the link to create their account and join your organisation automatically.
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Role <span className="text-red-500">*</span>
                </label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-slate-900"
                >
                  <option value="viewer">Viewer - Read-only access</option>
                  <option value="surveyor">Surveyor - Can create and edit surveys</option>
                  <option value="admin">Admin - Full access</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">{ROLE_DESCRIPTIONS[newUserRole]}</p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                disabled={isAddingUser}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInviteUser}
                disabled={isAddingUser || atSeatLimit || isTrialExpired || !newUserEmail.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAddingUser ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Sending...
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
