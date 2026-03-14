import { Link, useSearchParams } from 'react-router-dom';
import { ActiveFilterChip, ActiveFilterChips } from '../../components/filters/ActiveFilterChips';
import {
  RE_RECOMMENDATION_PRIORITIES,
  RE_RECOMMENDATION_STATUSES,
  type RecommendationStatusFilter,
  type RecommendationsRegisterRow,
  useRecommendationsRegister,
} from '../../hooks/useRecommendationsRegister';

const CREATED_WITHIN_OPTIONS = [7, 30, 90, 180];
const COMPLETED_WITHIN_OPTIONS = [7, 30, 90, 180];

function parseWithinDays(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null | undefined): string {
  const parsed = parseDate(value);
  if (!parsed) return '—';
  return parsed.toLocaleDateString();
}

function getPriorityBadgeClass(priority: string) {
  if (priority === 'High') return 'bg-rose-50 text-rose-700 border border-rose-200';
  if (priority === 'Medium') return 'bg-amber-50 text-amber-700 border border-amber-200';
  if (priority === 'Low') return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}

function getStatusBadgeClass(status: string) {
  if (status === 'Completed') return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  if (status === 'In Progress') return 'bg-blue-50 text-blue-700 border border-blue-200';
  if (status === 'Open') return 'bg-amber-50 text-amber-700 border border-amber-200';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}

function applyFilters(rows: RecommendationsRegisterRow[], filters: {
  status: RecommendationStatusFilter | null;
  priority: string | null;
  createdWithinDays: number | null;
  completedWithinDays: number | null;
  client: string | null;
  site: string | null;
  document: string | null;
}) {
  const now = new Date();

  return rows.filter((row) => {
    if (filters.status) {
      if (filters.status === 'Active') {
        if (row.status === 'Completed') return false;
      } else if (row.status !== filters.status) {
        return false;
      }
    }

    if (filters.priority && row.priority !== filters.priority) return false;
    if (filters.client && row.clientName !== filters.client) return false;
    if (filters.site && row.siteName !== filters.site) return false;
    if (filters.document && row.documentName !== filters.document) return false;

    if (filters.createdWithinDays) {
      const createdAt = parseDate(row.createdAt);
      if (!createdAt) return false;
      const createdCutoff = new Date(now.getTime() - filters.createdWithinDays * 24 * 60 * 60 * 1000);
      if (createdAt < createdCutoff) return false;
    }

    if (filters.completedWithinDays) {
      if (row.status !== 'Completed') return false;

      // Honest proxy: completion timestamp is not available in current model, so updatedAt is used.
      const completedProxy = parseDate(row.updatedAt);
      if (!completedProxy) return false;
      const completedCutoff = new Date(now.getTime() - filters.completedWithinDays * 24 * 60 * 60 * 1000);
      if (completedProxy < completedCutoff) return false;
    }

    return true;
  });
}

export default function RecommendationsRegisterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { rows, loading, error, options } = useRecommendationsRegister();

  const statusParam = searchParams.get('status');
  const priorityParam = searchParams.get('priority');
  const createdWithinDaysParam = searchParams.get('createdWithinDays');
  const completedWithinDaysParam = searchParams.get('completedWithinDays');
  const clientParam = searchParams.get('client');
  const siteParam = searchParams.get('site');
  const documentParam = searchParams.get('document');

  const statusFilter: RecommendationStatusFilter | null =
    statusParam === 'Active' || RE_RECOMMENDATION_STATUSES.includes(statusParam as (typeof RE_RECOMMENDATION_STATUSES)[number])
      ? (statusParam as RecommendationStatusFilter)
      : null;

  const priorityFilter = RE_RECOMMENDATION_PRIORITIES.includes(priorityParam as (typeof RE_RECOMMENDATION_PRIORITIES)[number])
    ? priorityParam
    : null;

  const createdWithinDaysFilter = parseWithinDays(createdWithinDaysParam);
  const completedWithinDaysFilter = parseWithinDays(completedWithinDaysParam);

  const filters = {
    status: statusFilter,
    priority: priorityFilter,
    createdWithinDays: createdWithinDaysFilter,
    completedWithinDays: completedWithinDaysFilter,
    client: clientParam,
    site: siteParam,
    document: documentParam,
  };

  const filteredRows = applyFilters(rows, filters);

  const setFilterParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const clearAllFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['status', 'priority', 'createdWithinDays', 'completedWithinDays', 'client', 'site', 'document'].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

  const activeChips: ActiveFilterChip[] = [];
  if (filters.status) {
    activeChips.push({ key: 'status', label: 'Status', value: filters.status === 'Active' ? 'Active (Open + In Progress)' : filters.status });
  }
  if (filters.priority) {
    activeChips.push({ key: 'priority', label: 'Priority', value: filters.priority });
  }
  if (filters.createdWithinDays) {
    activeChips.push({ key: 'createdWithinDays', label: 'Created', value: `Last ${filters.createdWithinDays} days` });
  }
  if (filters.completedWithinDays) {
    activeChips.push({ key: 'completedWithinDays', label: 'Completed', value: `Updated in last ${filters.completedWithinDays} days` });
  }
  if (filters.client) {
    activeChips.push({ key: 'client', label: 'Client', value: filters.client });
  }
  if (filters.site) {
    activeChips.push({ key: 'site', label: 'Site', value: filters.site });
  }
  if (filters.document) {
    activeChips.push({ key: 'document', label: 'Document', value: filters.document });
  }

  const hasFilters = activeChips.length > 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Risk Engineering Recommendations</h1>
        <p className="mt-2 text-slate-600">
          Operational register for RE recommendations with source-accurate status and priority semantics.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Status</span>
            <select
              value={filters.status || ''}
              onChange={(event) => setFilterParam('status', event.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              <option value="Active">Active (Open + In Progress)</option>
              {options.statuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Priority</span>
            <select
              value={filters.priority || ''}
              onChange={(event) => setFilterParam('priority', event.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All priorities</option>
              {options.priorities.map((priority) => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Created within</span>
            <select
              value={filters.createdWithinDays ? String(filters.createdWithinDays) : ''}
              onChange={(event) => setFilterParam('createdWithinDays', event.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Any time</option>
              {CREATED_WITHIN_OPTIONS.map((days) => (
                <option key={days} value={String(days)}>Last {days} days</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Completed within</span>
            <select
              value={filters.completedWithinDays ? String(filters.completedWithinDays) : ''}
              onChange={(event) => setFilterParam('completedWithinDays', event.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Any time</option>
              {COMPLETED_WITHIN_OPTIONS.map((days) => (
                <option key={days} value={String(days)}>Updated in last {days} days</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Client</span>
            <select
              value={filters.client || ''}
              onChange={(event) => setFilterParam('client', event.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All clients</option>
              {options.clients.map((client) => (
                <option key={client} value={client}>{client}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Site / Property</span>
            <select
              value={filters.site || ''}
              onChange={(event) => setFilterParam('site', event.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All sites</option>
              {options.sites.map((site) => (
                <option key={site} value={site}>{site}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Report / Document</span>
            <select
              value={filters.document || ''}
              onChange={(event) => setFilterParam('document', event.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All documents</option>
              {options.documents.map((document) => (
                <option key={document} value={document}>{document}</option>
              ))}
            </select>
          </label>
        </div>

        <ActiveFilterChips
          chips={activeChips}
          onRemove={(chipKey) => setFilterParam(chipKey, null)}
          onClearAll={clearAllFilters}
          className="mb-0"
        />

        {hasFilters && (
          <p className="text-xs text-slate-500">
            Completed-within filtering uses <code>updated_at</code> as a completion proxy because RE recommendations do not currently expose a dedicated completion timestamp.
          </p>
        )}
      </div>

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          Risk engineering recommendation data could not be fully loaded: {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-sm text-slate-600">
          {loading ? 'Loading recommendations…' : `${filteredRows.length} recommendations`}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-white">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Client</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Site / Property</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Recommendation</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Created</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Updated</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Report / Document</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-sm text-center text-slate-500">Loading register data…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-sm text-center text-slate-500">
                    No risk engineering recommendations found yet.
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-sm text-center text-slate-500">
                    No recommendations match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-sm text-slate-700">{row.clientName}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{row.siteName}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 max-w-sm">
                      <p className="font-medium truncate" title={row.title}>{row.title}</p>
                      <p className="text-xs text-slate-500 mt-1">Ref {row.recNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getPriorityBadgeClass(row.priority)}`}>
                        {row.priority || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getStatusBadgeClass(row.status)}`}>
                        {row.status || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{formatDate(row.updatedAt)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{row.documentName}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <Link
                        to={`/documents/${row.documentId}/workspace`}
                        className="text-slate-700 hover:text-slate-900 underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
