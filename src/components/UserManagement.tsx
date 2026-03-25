import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Trash2, Shield, Edit2, X, Check, AlertTriangle } from 'lucide-react';
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

interface UserProfile {
  id: string;
  role: UserRole;
  name: string | null;
  email?: string;
  created_at: string;
  is_platform_admin: boolean;
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
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('viewer');
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<UserRole>('viewer');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seatEntitlement, setSeatEntitlement] = useState<UserSeatEntitlement | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<UpgradeBlockReason>('user_limit');
  const [upgradeDetail, setUpgradeDetail] = useState<string | null>(null);

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
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const { data: memberData, error: memberError } = await supabase
        .from('organisation_members')
        .select('user_id, role, status, created_at')
        .eq('organisation_id', currentUser.organisation_id)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (memberError) {
        console.error('[UserManagement] Failed organisation_members query', {
          code: memberError.code,
          message: memberError.message,
          details: memberError.details,
          hint: memberError.hint,
          organisation_id: currentUser.organisation_id,
          query: "from('organisation_members').select('user_id, role, status, created_at').eq('organisation_id', ?).eq('status', 'active').order('created_at')",
        });
        throw memberError;
      }

      const activeMembers = (memberData ?? []) as OrganisationMemberRow[];
      const memberIds = activeMembers.map((member) => member.user_id);

      let profilesById = new Map<string, UserProfileRow>();
      if (memberIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('id, name, created_at, is_platform_admin')
          .in('id', memberIds);

        if (profileError) {
          console.error('[UserManagement] Failed user_profiles query', {
            code: profileError.code,
            message: profileError.message,
            details: profileError.details,
            hint: profileError.hint,
            member_count: memberIds.length,
            query: "from('user_profiles').select('id, name, created_at, is_platform_admin').in('id', member_ids)",
          });
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
          role: member.role,
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
      await refreshSeatEntitlement();
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'message' in error) {
        const supabaseError = error as {
          code?: string;
          message?: string;
          details?: string;
          hint?: string;
        };
        console.error('[UserManagement] Error fetching users', {
          code: supabaseError.code,
          message: supabaseError.message,
          details: supabaseError.details,
          hint: supabaseError.hint,
        });
      } else {
        console.error('[UserManagement] Error fetching users', error);
      }
      setLoadError('Failed to load users. Please try again.');
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!newUserEmail.trim()) {
      alert('Email is required');
      return;
    }

    if (!currentUser?.organisation_id) {
      alert('Cannot add users without an organisation context.');
      return;
    }

    setIsAddingUser(true);
    try {
      const entitlement = await getUserSeatEntitlement(currentUser.organisation_id);
      setSeatEntitlement(entitlement);

      if (!entitlement.allowed) {
        setUpgradeReason(inferUserUpgradeReason());
        setUpgradeDetail(getUserSeatLimitCopy(entitlement, organisation).body);
        setShowUpgradeModal(true);
        return;
      }

      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: newUserEmail.trim(),
        password: Math.random().toString(36).slice(-12) + 'Aa1!',
        options: {
          data: {
            name: newUserName.trim() || newUserEmail.trim(),
          },
        },
      });

      if (signUpError) throw signUpError;

      if (authData.user) {
        const { error: profileError } = await supabase
          .from('user_profiles')
          .update({ role: newUserRole })
          .eq('id', authData.user.id);

        if (profileError) throw profileError;
      }

      setShowAddModal(false);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('viewer');
      await fetchUsers();
    } catch (error: unknown) {
      console.error('Error adding user:', error);
      const message = normalizeSeatLimitErrorMessage(error);
      if (message.toLowerCase().includes('seat limit') || message.toLowerCase().includes('upgrade')) {
        setUpgradeReason(inferUserUpgradeReason());
        setUpgradeDetail(message);
        setShowUpgradeModal(true);
      } else {
        alert('Could not add user right now. Please try again.');
      }
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: UserRole) => {
    const adminCount = users.filter(u => u.role === 'admin').length;
    const currentUserProfile = users.find(u => u.id === userId);
    const isCurrentUserAdmin = currentUserProfile?.role === 'admin';
    const isDemotingFromAdmin = isCurrentUserAdmin && newRole !== 'admin';
    const isSelfDemotion = userId === currentUser?.id;

    if (adminCount === 1 && isDemotingFromAdmin) {
      alert('Cannot change role: At least one admin must remain in the system.');
      setEditingUserId(null);
      return;
    }

    if (isSelfDemotion && isDemotingFromAdmin && adminCount === 1) {
      alert('You cannot demote yourself as you are the only admin.');
      setEditingUserId(null);
      return;
    }

    try {
      const { error } = await supabase
        .from('organisation_members')
        .update({ role: newRole })
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
    const isRevokingPlatformAdmin = currentValue === true;

    if (platformAdminCount === 1 && isRevokingPlatformAdmin) {
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

  const handleDeleteUser = async (userId: string, userEmail?: string) => {
    const adminCount = users.filter(u => u.role === 'admin').length;
    const userToDelete = users.find(u => u.id === userId);
    const isAdminUser = userToDelete?.role === 'admin';
    const isSelfDeletion = userId === currentUser?.id;

    if (adminCount === 1 && isAdminUser) {
      alert('Cannot delete user: At least one admin must remain in the system.');
      return;
    }

    if (isSelfDeletion && isAdminUser && adminCount === 1) {
      alert('You cannot delete yourself as you are the only admin.');
      return;
    }

    if (!confirm(`Are you sure you want to delete user ${userEmail || 'this user'}? This action cannot be undone.`)) {
      return;
    }

    alert('Direct account deletion from the frontend is disabled for security. Please use the secure admin backend flow.');
  };

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-700 border-red-300';
      case 'surveyor':
        return 'bg-blue-100 text-blue-700 border-blue-300';
      case 'viewer':
        return 'bg-slate-100 text-slate-700 border-slate-300';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
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
            <p className="font-semibold">You’re close to your seat limit ({currentUsers} of {maxUsers} users).</p>
          </div>
        </div>
      )}

      {atSeatLimit && (
        <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              <p className="font-semibold">You’ve reached your user limit ({maxUsers}). Upgrade to add more team members.</p>
              <p>{seatLimitCopy.body}</p>
              <button
                onClick={() => window.location.assign(buildUpgradePath('user_limit', { action: 'manage_users' }))}
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

      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">User Management</h2>
          <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 rounded">
            {`${currentUsers}/${maxUsers} seats`}
          </span>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={atSeatLimit}
          title={atSeatLimit ? seatLimitCopy.body : 'Add User'}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="w-[24%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                User
              </th>
              <th className="w-[26%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Email
              </th>
              <th className="w-[16%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Role
              </th>
              {isPlatformAdmin && (
                <th className="w-[14%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Platform Admin
                </th>
              )}
              <th className="w-[12%] px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Created
              </th>
              <th className="w-[12%] px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                Actions
              </th>
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
                        onClick={() => {
                          setEditingUserId(user.id);
                          setEditingRole(user.role);
                        }}
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
                        <span className="text-sm text-slate-700">
                          {user.is_platform_admin ? 'Yes' : 'No'}
                        </span>
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
                    onClick={() => handleDeleteUser(user.id, user.email)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Delete user"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
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
          <p className="text-sm text-slate-500">Add your first user to get started</p>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Add New User</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 border border-amber-200">
                Invites are blocked when your organisation reaches the active user seat limit for its plan.
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
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Name
                </label>
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
                <p className="mt-1 text-xs text-slate-500">
                  {ROLE_DESCRIPTIONS[newUserRole]}
                </p>
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
                onClick={handleAddUser}
                disabled={isAddingUser || atSeatLimit}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAddingUser ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Add User
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
