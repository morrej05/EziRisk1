import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

type MemberRole = 'owner' | 'admin' | 'consultant' | 'viewer';

interface OrgMember {
  user_id: string;
  organisation_id: string;
  role: MemberRole;
  status: string;
  user_profile: {
    id: string;
    name: string | null;
  } | null;
}

interface OrganisationMemberRow {
  user_id: string;
  organisation_id: string;
  role: MemberRole;
  status: string;
}

interface UserProfileRow {
  id: string;
  name: string | null;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  consultant: 'Consultant',
  viewer: 'Viewer',
};

export default function AccountLifecyclePanel() {
  const { user } = useAuth();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [organisationId, setOrganisationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string>('');
  const [selfDeleteTransferOrgId, setSelfDeleteTransferOrgId] = useState<string>('');
  const [selfDeleteTransferToUserId, setSelfDeleteTransferToUserId] = useState<string>('');
  const [working, setWorking] = useState(false);
  const [soloFlowStarted, setSoloFlowStarted] = useState(false);
  const [soloFlowAcknowledgedAccountDelete, setSoloFlowAcknowledgedAccountDelete] = useState(false);
  const [soloFlowAcknowledgedOrgClose, setSoloFlowAcknowledgedOrgClose] = useState(false);
  const [soloFlowPhrase, setSoloFlowPhrase] = useState('');
  const [soloFlowPassword, setSoloFlowPassword] = useState('');

  const ownerCount = useMemo(() => members.filter((m) => m.role === 'owner').length, [members]);
  const memberCount = members.length;
  const canManageMembers = currentRole === 'owner' || currentRole === 'admin';
  const isCurrentUserSoleOwner = currentRole === 'owner' && ownerCount <= 1;
  const isCurrentUserSoloOwnerAndMember = currentRole === 'owner' && ownerCount === 1 && memberCount === 1;
  const soloConfirmationPhrase = 'CLOSE ORGANISATION AND DELETE ACCOUNT';

  const loadMembers = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: selfMembership, error: selfMembershipError } = await supabase
        .from('organisation_members')
        .select('organisation_id, role')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (selfMembershipError) {
        throw selfMembershipError;
      }

      if (!selfMembership?.organisation_id) {
        setMembers([]);
        setCurrentRole(null);
        setOrganisationId(null);
        setLoading(false);
        return;
      }

      setOrganisationId(selfMembership.organisation_id);
      setCurrentRole((selfMembership.role as MemberRole) ?? null);
      setSelfDeleteTransferOrgId(selfMembership.organisation_id);

      const { data: orgMembers, error: membersError } = await supabase
        .from('organisation_members')
        .select('user_id, organisation_id, role, status')
        .eq('organisation_id', selfMembership.organisation_id)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (membersError) {
        throw membersError;
      }

      const memberRows = (orgMembers as OrganisationMemberRow[] | null) ?? [];
      const userIds = [...new Set(memberRows.map((member) => member.user_id))];

      const { data: profiles, error: profilesError } = userIds.length
        ? await supabase.from('user_profiles').select('id, name').in('id', userIds)
        : { data: [], error: null };

      if (profilesError) {
        throw profilesError;
      }

      const profileMap = new Map(((profiles as UserProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]));
      setMembers(
        memberRows.map((member) => ({
          ...member,
          user_profile: profileMap.get(member.user_id) ?? null,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organisation members');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const invokeLifecycleFunction = async (fnName: string, payload: Record<string, string | null>) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error('You must be signed in to continue.');
    }

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Request failed');
    }

    return result;
  };

  const removeMember = async (targetUserId: string, targetRole: MemberRole) => {
    if (!organisationId) return;

    const isSoleOwnerRemoval = targetRole === 'owner' && ownerCount <= 1;
    if (isSoleOwnerRemoval && !transferTargetId) {
      setError('Ownership transfer is required before removing the sole owner.');
      return;
    }

    if (!window.confirm('Remove this member from the organisation? This action is destructive.')) {
      return;
    }

    setWorking(true);
    setRemovingUserId(targetUserId);
    setError(null);
    try {
      await invokeLifecycleFunction('remove-org-member', {
        organisation_id: organisationId,
        target_user_id: targetUserId,
        transfer_to_user_id: isSoleOwnerRemoval ? transferTargetId : null,
      });
      setTransferTargetId('');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setWorking(false);
      setRemovingUserId(null);
    }
  };

  const transferOwnership = async () => {
    if (!organisationId || !transferTargetId) {
      setError('Select a member before transferring ownership.');
      return;
    }

    if (!window.confirm('Transfer ownership to the selected member?')) {
      return;
    }

    setWorking(true);
    setError(null);
    try {
      await invokeLifecycleFunction('transfer-org-ownership', {
        organisation_id: organisationId,
        to_user_id: transferTargetId,
      });
      setTransferTargetId('');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer ownership');
    } finally {
      setWorking(false);
    }
  };

  const selfDeleteAccount = async () => {
    if (isCurrentUserSoloOwnerAndMember) {
      const isPhraseValid = soloFlowPhrase.trim() === soloConfirmationPhrase;
      if (!soloFlowAcknowledgedAccountDelete || !soloFlowAcknowledgedOrgClose || !isPhraseValid) {
        setError('Complete all acknowledgements and type the confirmation phrase exactly to continue.');
        return;
      }

      if (!user?.email) {
        setError('Unable to re-authenticate: signed-in user email is missing.');
        return;
      }

      if (!soloFlowPassword) {
        setError('Enter your password to confirm this destructive action.');
        return;
      }

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: soloFlowPassword,
      });
      if (reauthError) {
        setError(`Re-authentication failed: ${reauthError.message}`);
        return;
      }

      setWorking(true);
      setError(null);
      try {
        await invokeLifecycleFunction('self-delete-account', {
          transfer_organisation_id: null,
          transfer_to_user_id: null,
          workflow: 'solo_owner_close_org',
          confirmation_phrase: soloFlowPhrase.trim(),
        });
        await supabase.auth.signOut();
        window.location.assign('/signin');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to close organisation and delete account');
      } finally {
        setWorking(false);
      }
      return;
    }

    const confirmation = window.prompt('Type DELETE to permanently delete your account.');
    if (confirmation !== 'DELETE') {
      setError('Account deletion cancelled. Type DELETE exactly to continue.');
      return;
    }

    if (isCurrentUserSoleOwner && (!selfDeleteTransferOrgId || !selfDeleteTransferToUserId)) {
      setError('Sole owner must transfer ownership before self-delete.');
      return;
    }

    setWorking(true);
    setError(null);
    try {
      await invokeLifecycleFunction('self-delete-account', {
        transfer_organisation_id: isCurrentUserSoleOwner ? selfDeleteTransferOrgId : null,
        transfer_to_user_id: isCurrentUserSoleOwner ? selfDeleteTransferToUserId : null,
        workflow: null,
        confirmation_phrase: null,
      });
      await supabase.auth.signOut();
      window.location.assign('/signin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Account & Organisation Lifecycle</h2>
        <p className="text-sm text-slate-600 mt-1">
          Destructive actions are guarded by membership-first backend checks and require explicit confirmation.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-slate-900">Organisation Members</h3>
        {loading ? (
          <p className="text-sm text-slate-600">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-slate-600">No active organisation members found.</p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-md">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Role</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.user_id === user?.id;
                  return (
                    <tr key={member.user_id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-900">
                        {member.user_profile?.name || 'Unnamed user'}
                        {isSelf ? <span className="ml-2 text-xs text-slate-500">(You)</span> : null}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{ROLE_LABELS[member.role]}</td>
                      <td className="px-3 py-2">
                        {canManageMembers || isSelf ? (
                          <button
                            onClick={() => void removeMember(member.user_id, member.role)}
                            disabled={working && removingUserId === member.user_id}
                            className="px-2.5 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60"
                          >
                            {isSelf ? 'Leave / Remove self' : 'Remove member'}
                          </button>
                        ) : (
                          <span className="text-slate-400">No access</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-slate-900">Ownership Transfer</h3>
        <p className="text-sm text-slate-600">Required before removing or deleting a sole owner account.</p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={transferTargetId}
            onChange={(e) => setTransferTargetId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm"
          >
            <option value="">Select transfer target</option>
            {members
              .filter((m) => m.user_id !== user?.id)
              .map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {(member.user_profile?.name || member.user_id).slice(0, 60)} ({ROLE_LABELS[member.role]})
                </option>
              ))}
          </select>
          <button
            onClick={() => void transferOwnership()}
            disabled={working || currentRole !== 'owner'}
            className="px-3 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-60"
          >
            Transfer ownership
          </button>
          {currentRole !== 'owner' && <span className="text-xs text-slate-500">Only owners can transfer ownership.</span>}
        </div>
      </section>

      <section className="space-y-3 border border-red-200 bg-red-50 rounded-md p-4">
        <h3 className="text-base font-semibold text-red-900">Danger Zone</h3>
        {isCurrentUserSoloOwnerAndMember && (
          <div className="rounded-md border border-red-300 bg-red-100 p-3 text-sm text-red-900 space-y-2">
            <p className="font-semibold">You are the only active owner and only active member of this organisation.</p>
            <p>Deleting your account will permanently close/deactivate this organisation in the same action.</p>
          </div>
        )}

        {isCurrentUserSoleOwner && !isCurrentUserSoloOwnerAndMember && (
          <div className="flex items-start gap-2 text-sm text-red-900">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <p>
              {isCurrentUserSoloOwnerAndMember
                ? 'You cannot use member-removal transfer here. Use the dedicated close-organisation + account-delete workflow below.'
                : 'You are the sole owner. Select a transfer target below before deleting your account.'}
            </p>
          </div>
        )}

        {isCurrentUserSoleOwner && !isCurrentUserSoloOwnerAndMember && (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selfDeleteTransferToUserId}
              onChange={(e) => setSelfDeleteTransferToUserId(e.target.value)}
              className="px-3 py-2 border border-red-300 rounded-md text-sm"
            >
              <option value="">Select new owner before self-delete</option>
              {members
                .filter((m) => m.user_id !== user?.id)
                .map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {(member.user_profile?.name || member.user_id).slice(0, 60)}
                  </option>
                ))}
            </select>
          </div>
        )}

        {isCurrentUserSoloOwnerAndMember ? (
          <div className="space-y-3 rounded-md border border-red-300 bg-white p-3">
            {!soloFlowStarted ? (
              <button
                onClick={() => setSoloFlowStarted(true)}
                disabled={working}
                className="px-3 py-2 rounded-md border border-red-400 text-red-700 hover:bg-red-100 text-sm disabled:opacity-60"
              >
                Start account closure flow
              </button>
            ) : (
              <>
                <label className="flex items-start gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={soloFlowAcknowledgedAccountDelete}
                    onChange={(e) => setSoloFlowAcknowledgedAccountDelete(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I understand my account will be permanently deleted and cannot be recovered.</span>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={soloFlowAcknowledgedOrgClose}
                    onChange={(e) => setSoloFlowAcknowledgedOrgClose(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I understand this action will close/deactivate my organisation and end access for this workspace.</span>
                </label>

                <div className="space-y-1">
                  <label htmlFor="solo-delete-phrase" className="text-sm font-medium text-slate-800">
                    Type <code>{soloConfirmationPhrase}</code> to confirm
                  </label>
                  <input
                    id="solo-delete-phrase"
                    type="text"
                    value={soloFlowPhrase}
                    onChange={(e) => setSoloFlowPhrase(e.target.value)}
                    placeholder={soloConfirmationPhrase}
                    className="w-full px-3 py-2 border border-red-300 rounded-md text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="solo-delete-password" className="text-sm font-medium text-slate-800">
                    Confirm your password
                  </label>
                  <input
                    id="solo-delete-password"
                    type="password"
                    value={soloFlowPassword}
                    onChange={(e) => setSoloFlowPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full px-3 py-2 border border-red-300 rounded-md text-sm"
                  />
                </div>

                <button
                  onClick={() => void selfDeleteAccount()}
                  disabled={working}
                  className="px-3 py-2 rounded-md bg-red-700 text-white hover:bg-red-800 text-sm disabled:opacity-60"
                >
                  Close organisation and delete account
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void selfDeleteAccount()}
                disabled={working}
                className="px-3 py-2 rounded-md border border-red-400 text-red-700 hover:bg-red-100 text-sm disabled:opacity-60"
              >
                Delete my account
              </button>

              <button
                disabled
                title="Organisation cancellation backend endpoint is not yet enabled"
                className="px-3 py-2 rounded-md border border-slate-300 text-slate-500 text-sm cursor-not-allowed"
              >
                Cancel / Deactivate organisation (coming soon)
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Placeholder wired target: <code>/functions/v1/cancel-organisation</code> (enable backend endpoint before launch).
            </p>
          </>
        )}
      </section>
    </div>
  );
}
