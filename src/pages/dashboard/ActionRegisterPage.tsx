import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileText,
  Download,
  Filter,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import {
  ActionRegisterEntry,
  getActionRegisterOrgLevel,
  filterActionRegister,
  downloadActionRegisterCSV,
  getActionRegisterStats,
  getTrackingStatusColor,
  getTrackingStatusLabel,
  getUniqueModuleKeys,
  getUniqueDocumentTypes,
  getModuleKeyLabel,
} from '../../utils/actionRegister';
import { Button, Card } from '../../components/ui/DesignSystem';
import { subscribeActionsVersion, getActionsVersion } from '../../lib/actions/actionsInvalidation';
import { ActiveFilterChip, ActiveFilterChips } from '../../components/filters/ActiveFilterChips';

export default function ActionRegisterPage() {
  const { organisation } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const getParamValues = (key: string): string[] => {
    const allValues = searchParams.getAll(key).filter(Boolean);
    if (allValues.length > 0) return allValues;
    const singleValue = searchParams.get(key);
    return singleValue ? [singleValue] : [];
  };

  const documentFilter = searchParams.get('document');
  const statusParams = getParamValues('status');
  const priorityParams = getParamValues('priority');
  const moduleParams = getParamValues('module');
  const siteParam = searchParams.get('site');
  const clientParam = searchParams.get('client');
  const sourceTypeParam = searchParams.get('sourceType');
  const typeParam = searchParams.get('type');
  const openedWithinParam = searchParams.get('openedWithinDays');
  const closedWithinParam = searchParams.get('closedWithinDays');
  const portfolioSourceState = (location.state as { source?: string } | null)?.source;

  const [actions, setActions] = useState<ActionRegisterEntry[]>([]);
  const [filteredActions, setFilteredActions] = useState<ActionRegisterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [documentTitle, setDocumentTitle] = useState<string | null>(null);
  const [actionsVersion, setActionsVersion] = useState(getActionsVersion());

  const [filters, setFilters] = useState({
    status: [] as string[],
    priority: [] as string[],
    trackingStatus: [] as string[],
    documentType: [] as string[],
    moduleKey: moduleParams,
    overdue: false,
    documentId: documentFilter || undefined,
    sourceType: sourceTypeParam || undefined,
    openedWithinDays: openedWithinParam ? Number(openedWithinParam) : undefined,
    closedWithinDays: closedWithinParam ? Number(closedWithinParam) : undefined,
    type: typeParam || undefined,
  });

  useEffect(() => {
    const unsubscribe = subscribeActionsVersion(() => setActionsVersion(getActionsVersion()));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (organisation?.id) {
      fetchData();
    }
    // fetchData intentionally reads latest filter state during hydration after URL params update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation?.id, actionsVersion]);


  useEffect(() => {
    const nextStatus = statusParams;
    const nextPriority = priorityParams;
    const nextModule = moduleParams;

    setFilters((prev) => {
      const nextOpenedWithin = openedWithinParam ? Number(openedWithinParam) : undefined;
      const nextClosedWithin = closedWithinParam ? Number(closedWithinParam) : undefined;
      const changed =
        JSON.stringify(prev.status) !== JSON.stringify(nextStatus) ||
        JSON.stringify(prev.priority) !== JSON.stringify(nextPriority) ||
        JSON.stringify(prev.moduleKey) !== JSON.stringify(nextModule) ||
        prev.documentId !== (documentFilter || undefined) ||
        prev.sourceType !== (sourceTypeParam || undefined) ||
        prev.openedWithinDays !== nextOpenedWithin ||
        prev.closedWithinDays !== nextClosedWithin ||
        prev.type !== (typeParam || undefined);

      if (!changed) return prev;

      return {
        ...prev,
        status: nextStatus,
        priority: nextPriority,
        moduleKey: nextModule,
        documentId: documentFilter || undefined,
        sourceType: sourceTypeParam || undefined,
        openedWithinDays: nextOpenedWithin,
        closedWithinDays: nextClosedWithin,
        type: typeParam || undefined,
      };
    });
  }, [closedWithinParam, documentFilter, moduleParams, openedWithinParam, priorityParams, sourceTypeParam, statusParams, typeParam]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);

    nextParams.delete('status');
    filters.status.forEach((status) => nextParams.append('status', status));

    nextParams.delete('priority');
    filters.priority.forEach((priority) => nextParams.append('priority', priority));

    nextParams.delete('module');
    filters.moduleKey.forEach((moduleKey) => nextParams.append('module', moduleKey));

    if (filters.documentId) {
      nextParams.set('document', filters.documentId);
    } else {
      nextParams.delete('document');
    }


    if (filters.sourceType) {
      nextParams.set('sourceType', filters.sourceType);
    } else {
      nextParams.delete('sourceType');
    }

    if (filters.openedWithinDays) {
      nextParams.set('openedWithinDays', String(filters.openedWithinDays));
    } else {
      nextParams.delete('openedWithinDays');
    }

    if (filters.closedWithinDays) {
      nextParams.set('closedWithinDays', String(filters.closedWithinDays));
    } else {
      nextParams.delete('closedWithinDays');
    }

    if (filters.type) {
      nextParams.set('type', filters.type);
    } else {
      nextParams.delete('type');
    }
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [filters.closedWithinDays, filters.documentId, filters.moduleKey, filters.openedWithinDays, filters.priority, filters.sourceType, filters.status, filters.type, searchParams, setSearchParams]);

  useEffect(() => {
    if (documentFilter && actions.length > 0) {
      const doc = actions.find(a => a.document_id === documentFilter);
      if (doc) {
        setDocumentTitle(doc.document_title);
      }
    }
  }, [documentFilter, actions]);

  useEffect(() => {
    const toDate = (value: string | null) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const now = new Date();
    const openedCutoff = filters.openedWithinDays
      ? new Date(now.getTime() - filters.openedWithinDays * 24 * 60 * 60 * 1000)
      : null;
    const closedCutoff = filters.closedWithinDays
      ? new Date(now.getTime() - filters.closedWithinDays * 24 * 60 * 60 * 1000)
      : null;

    let filtered = filterActionRegister(actions, filters);

    if (filters.type) {
      const normalised = filters.type.toUpperCase();
      filtered = filtered.filter((action) => {
        if (normalised === 'FIRE STRATEGY') return action.document_type.toUpperCase() === 'FSD';
        return action.document_type.toUpperCase() === normalised;
      });
    }

    if (siteParam) {
      const term = siteParam.toLowerCase();
      filtered = filtered.filter((action) => action.document_title.toLowerCase().includes(term));
    }

    if (filters.sourceType === 'assessment_action') {
      filtered = filtered.filter((action) => action.source !== 're_recommendation');
    }

    if (openedCutoff) {
      filtered = filtered.filter((action) => {
        const createdAt = toDate(action.created_at);
        return createdAt !== null && createdAt >= openedCutoff;
      });
    }

    if (closedCutoff) {
      filtered = filtered.filter((action) => {
        const closedAt = toDate(action.closed_at);
        return closedAt !== null && closedAt >= closedCutoff;
      });
    }

    setFilteredActions(filtered);
  }, [actions, filters, siteParam]);

  const fetchData = async () => {
    if (!organisation?.id) return;

    setIsLoading(true);
    const actionsData = await getActionRegisterOrgLevel(organisation.id);

    setActions(actionsData);
    setFilteredActions(actionsData);
    setIsLoading(false);
  };

  const handleExportCSV = () => {
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = documentFilter && documentTitle
      ? `actions_${documentTitle.replace(/[^a-z0-9]/gi, '_')}_${dateStr}.csv`
      : `action_register_${dateStr}.csv`;
    downloadActionRegisterCSV(filteredActions, filename);
  };

  const toggleFilter = (
    filterType: 'status' | 'priority' | 'trackingStatus' | 'documentType' | 'moduleKey',
    value: string
  ) => {
    setFilters((prev) => ({
      ...prev,
      [filterType]: prev[filterType].includes(value)
        ? prev[filterType].filter((v) => v !== value)
        : [...prev[filterType], value],
    }));
  };

  const clearFilters = () => {
    setFilters({
      status: [],
      priority: [],
      trackingStatus: [],
      documentType: [],
      moduleKey: [],
      overdue: false,
      documentId: undefined,
      sourceType: undefined,
      openedWithinDays: undefined,
      closedWithinDays: undefined,
      type: undefined,
    });
  };

  const stats = getActionRegisterStats(filteredActions);
  const availableModuleKeys = getUniqueModuleKeys(actions);
  const availableDocumentTypes = getUniqueDocumentTypes(actions);
  const hasActiveFilters =
    Boolean(filters.documentId) ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.trackingStatus.length > 0 ||
    filters.documentType.length > 0 ||
    filters.moduleKey.length > 0 ||
    Boolean(filters.type) ||
    filters.overdue ||
    Boolean(filters.sourceType) ||
    Boolean(filters.openedWithinDays) ||
    Boolean(filters.closedWithinDays);

  const formatStatusLabel = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  const activeChips = (() => {
    const chips: ActiveFilterChip[] = [];

    filters.priority.forEach((priority) => {
      chips.push({ key: `priority:${priority}`, label: 'Priority', value: priority });
    });

    filters.status.forEach((status) => {
      chips.push({ key: `status:${status}`, label: 'Status', value: formatStatusLabel(status) });
    });

    filters.moduleKey.forEach((moduleKey) => {
      chips.push({ key: `module:${moduleKey}`, label: 'Module', value: getModuleKeyLabel(moduleKey) });
    });

    if (filters.documentId) {
      chips.push({
        key: `document:${filters.documentId}`,
        label: 'Document',
        value: documentTitle || filters.documentId,
      });
    }



    if (filters.sourceType) {
      chips.push({
        key: `sourceType:${filters.sourceType}`,
        label: 'Source',
        value: filters.sourceType === 'assessment_action' ? 'Assessment Actions' : filters.sourceType,
      });
    }

    if (filters.openedWithinDays) {
      chips.push({ key: 'openedWithinDays', label: 'Opened', value: `Last ${filters.openedWithinDays} days` });
    }

    if (filters.closedWithinDays) {
      chips.push({ key: 'closedWithinDays', label: 'Closed', value: `Last ${filters.closedWithinDays} days` });
    }

    return chips;
  })();

  const removeChip = (chipKey: string) => {
    const [type, value] = chipKey.split(':');

    if (type === 'status') {
      setFilters((prev) => ({ ...prev, status: prev.status.filter((item) => item !== value) }));
    }

    if (type === 'priority') {
      setFilters((prev) => ({ ...prev, priority: prev.priority.filter((item) => item !== value) }));
    }

    if (type === 'module') {
      setFilters((prev) => ({ ...prev, moduleKey: prev.moduleKey.filter((item) => item !== value) }));
    }

    if (type === 'document') {
      setFilters((prev) => ({ ...prev, documentId: undefined }));
    }

    if (type === 'sourceType') {
      setFilters((prev) => ({ ...prev, sourceType: undefined }));
    }

    if (chipKey === 'openedWithinDays') {
      setFilters((prev) => ({ ...prev, openedWithinDays: undefined }));
    }

    if (chipKey === 'closedWithinDays') {
      setFilters((prev) => ({ ...prev, closedWithinDays: undefined }));
    }
  };

  const hasPortfolioContext = (portfolioSourceState === 'portfolio' || Boolean(siteParam) || Boolean(clientParam)) && activeChips.length > 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-neutral-200 border-t-red-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-neutral-200 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-neutral-900">
                  Action Register
                  {documentTitle && (
                    <span className="text-lg font-normal text-neutral-600 ml-2">
                      — {documentTitle}
                    </span>
                  )}
                </h1>
                <p className="text-sm text-neutral-600">
                  {documentFilter
                    ? 'Document-level action tracking'
                    : 'Organisation-wide action tracking and management'}
                </p>
                {siteParam && (
                  <p className="text-xs text-neutral-600 mt-1">Site hint: {siteParam}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {documentFilter && (
                <Button
                  variant="secondary"
                  onClick={() => navigate('/dashboard/actions')}
                >
                  View All Actions
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => setShowFilters(!showFilters)}
                className={hasActiveFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : ''}
              >
                <Filter className="w-4 h-4 mr-2" />
                Filter {hasActiveFilters && `(${
                  filters.status.length +
                  filters.priority.length +
                  filters.trackingStatus.length +
                  filters.documentType.length +
                  filters.moduleKey.length
                })`}
              </Button>

              <Button
                onClick={handleExportCSV}
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {hasPortfolioContext && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Showing results filtered from Portfolio.
          </div>
        )}

        <ActiveFilterChips chips={activeChips} onRemove={removeChip} onClearAll={clearFilters} />

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card>
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-5 h-5 text-neutral-600" />
              <span className="text-sm font-medium text-neutral-700">Total Actions</span>
            </div>
            <p className="text-3xl font-semibold text-neutral-900">{stats.total}</p>
          </Card>

          <Card>
            <div className="flex items-center gap-3 mb-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span className="text-sm font-medium text-neutral-700">Overdue</span>
            </div>
            <p className="text-3xl font-semibold text-red-600">{stats.overdue}</p>
          </Card>

          <Card>
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <span className="text-sm font-medium text-neutral-700">In Progress</span>
            </div>
            <p className="text-3xl font-semibold text-amber-600">{stats.inProgress}</p>
          </Card>

          <Card>
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-neutral-700">Closed</span>
            </div>
            <p className="text-3xl font-semibold text-green-600">{stats.closed}</p>
          </Card>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <Card className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-neutral-900">Filters</h3>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-neutral-600 hover:text-neutral-900 font-medium"
                >
                  Clear All
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-6">
              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Status
                </label>
                <div className="space-y-2">
                  {['open', 'in_progress', 'deferred', 'closed'].map((status) => (
                    <label key={status} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.status.includes(status)}
                        onChange={() => toggleFilter('status', status)}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-sm text-neutral-700 capitalize">
                        {status.replace('_', ' ')}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Priority Filter */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Priority
                </label>
                <div className="space-y-2">
                  {['P1', 'P2', 'P3', 'P4'].map((priority) => (
                    <label key={priority} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.priority.includes(priority)}
                        onChange={() => toggleFilter('priority', priority)}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-sm text-neutral-700">{priority}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Tracking Status Filter */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Tracking Status
                </label>
                <div className="space-y-2">
                  {['overdue', 'due_soon', 'on_track', 'closed'].map((status) => (
                    <label key={status} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.trackingStatus.includes(status)}
                        onChange={() => toggleFilter('trackingStatus', status)}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-sm text-neutral-700">
                        {getTrackingStatusLabel(status)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Document Type Filter */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Document Type
                </label>
                <div className="space-y-2">
                  {availableDocumentTypes.map((type) => (
                    <label key={type} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.documentType.includes(type)}
                        onChange={() => toggleFilter('documentType', type)}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-sm text-neutral-700">{type}</span>
                    </label>
                  ))}
                  {availableDocumentTypes.length === 0 && (
                    <p className="text-sm text-neutral-500">No types available</p>
                  )}
                </div>
              </div>

              {/* Module Filter */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Module
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {availableModuleKeys.map((key) => (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.moduleKey.includes(key)}
                        onChange={() => toggleFilter('moduleKey', key)}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-sm text-neutral-700" title={key}>
                        {getModuleKeyLabel(key)}
                      </span>
                    </label>
                  ))}
                  {availableModuleKeys.length === 0 && (
                    <p className="text-sm text-neutral-500">No modules available</p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Actions Table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-neutral-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                    Ref
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-700">
                    Document
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-700">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-700 uppercase tracking-wider">
                    Priority
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-700 uppercase tracking-wider">
                    Tracking
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-700 uppercase tracking-wider">
                    Target Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-700 uppercase tracking-wider">
                    Owner
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredActions.map((action) => (
                  <tr
                    key={action.id}
                    className="hover:bg-neutral-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/documents/${action.document_id}/workspace?openAction=${action.id}`)}
                  >
                    <td className="px-4 py-3 text-sm font-mono text-neutral-900">
                      {action.reference_number ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-neutral-900">
                        {action.document_title}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-neutral-500">
                          {action.document_type} v{action.version_number}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          action.issue_status === 'issued'
                            ? 'bg-green-100 text-green-700'
                            : action.issue_status === 'draft'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-neutral-100 text-neutral-700'
                        }`}>
                          {action.issue_status}
                        </span>
                        {(action.carried_from_document_id || action.origin_action_id) && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                            Carried forward
                          </span>
                        )}
                      </div>
                      {action.module_key && (
                        <div className="text-xs text-neutral-500 mt-0.5">
                          {getModuleKeyLabel(action.module_key)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-neutral-700 max-w-md truncate">
                        {action.recommended_action}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        action.priority_band === 'P1' ? 'bg-red-100 text-red-700' :
                        action.priority_band === 'P2' ? 'bg-amber-100 text-amber-700' :
                        action.priority_band === 'P3' ? 'bg-blue-100 text-blue-700' :
                        'bg-neutral-100 text-neutral-700'
                      }`}>
                        {action.priority_band}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-neutral-700 capitalize">
                        {action.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${
                        getTrackingStatusColor(action.tracking_status)
                      }`}>
                        {getTrackingStatusLabel(action.tracking_status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {action.target_date ? (
                        <span className="text-sm text-neutral-700">
                          {new Date(action.target_date).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-sm text-neutral-400">No date</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-neutral-700">
                        {action.owner_name || 'Unassigned'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredActions.length === 0 && (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-600 font-medium">No actions found</p>
              <p className="text-sm text-neutral-500 mt-1">
                {hasActiveFilters
                  ? 'Try adjusting your filters'
                  : 'Actions will appear here as documents are issued'}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
