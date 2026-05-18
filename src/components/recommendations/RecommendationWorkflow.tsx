import type { ReactNode } from 'react';
import { CalendarDays, CheckCircle, FileCheck, Upload } from 'lucide-react';

export type RecommendationPriority = 'P1' | 'P2' | 'P3' | 'P4' | 'High' | 'Medium' | 'Low' | string | null | undefined;

export interface RecommendationWorkflowContext {
  documentId: string;
  moduleInstanceId: string;
  sourceKey?: string | null;
  sourceLabel?: string | null;
  defaultCategory?: string | null;
  severity?: string | null;
  recommendationType?: string | null;
}

export interface RecommendationCardItem {
  id: string;
  findingSummary: string;
  recommendationText: string;
  priority: RecommendationPriority;
  status: string;
  dueDate?: string | null;
  evidenceCount?: number;
  sourceLabel?: string | null;
  referenceNumber?: string | null;
}

export function priorityToBand(priority: RecommendationPriority): 'P1' | 'P2' | 'P3' | 'P4' | null {
  if (!priority) return null;
  if (priority === 'High') return 'P1';
  if (priority === 'Medium') return 'P2';
  if (priority === 'Low') return 'P3';
  if (['P1', 'P2', 'P3', 'P4'].includes(priority)) return priority as 'P1' | 'P2' | 'P3' | 'P4';
  return null;
}

export function getPriorityBadgeClasses(priority: RecommendationPriority): string {
  switch (priorityToBand(priority)) {
    case 'P1':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'P2':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case 'P3':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'P4':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

export function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case 'closed':
    case 'Completed':
      return 'border-green-200 bg-green-50 text-green-700';
    case 'in_progress':
    case 'In Progress':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'deferred':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'open':
    case 'Open':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

export function formatSuggestedCompletion(timescale: string | null | undefined): string {
  switch (timescale) {
    case 'immediate':
      return 'Immediately';
    case '7d':
      return 'Within 7 days';
    case '30d':
      return 'Within 30 days';
    case '90d':
      return 'Within 90 days';
    case 'next_review':
      return 'By the next scheduled review';
    default:
      return 'To be agreed by the assessor';
  }
}

export function getPriorityExplanation(priority: RecommendationPriority): string {
  switch (priorityToBand(priority)) {
    case 'P1':
      return 'Critical life-safety, fire-spread or business-continuity exposure requiring immediate management attention and prompt remediation.';
    case 'P2':
      return 'Significant fire risk or compliance weakness requiring timely control improvement to reduce foreseeable harm or operational disruption.';
    case 'P3':
      return 'Moderate deficiency where planned remediation will improve resilience, compliance confidence and day-to-day control effectiveness.';
    case 'P4':
      return 'Lower-risk improvement or assurance item suitable for planned review, documentation update or routine management action.';
    default:
      return 'Priority should reflect the assessor’s professional judgement, observed controls and likely operational consequence.';
  }
}

interface RecommendationWorkflowShellProps {
  title?: string;
  context: RecommendationWorkflowContext;
  priority: RecommendationPriority;
  suggestedTimescale?: string | null;
  targetDate?: string | null;
  evidenceCount?: number;
  children: ReactNode;
}

export function RecommendationWorkflowShell({
  title = 'Recommendation workflow',
  context,
  priority,
  suggestedTimescale,
  targetDate,
  evidenceCount = 0,
  children,
}: RecommendationWorkflowShellProps) {
  const priorityBand = priorityToBand(priority) || '—';

  return (
    <div className="space-y-4 rounded-xl border border-blue-100 bg-gradient-to-br from-white to-blue-50/30 p-4 sm:p-5">
      <div className="flex flex-col gap-3 border-b border-blue-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Unified finding workflow</p>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">
            Finding → Evidence → Recommended Action → Priority → Due Date
          </p>
          {context.sourceLabel ? (
            <p className="mt-2 text-xs text-slate-500">Linked source: {context.sourceLabel}</p>
          ) : null}
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-3 lg:min-w-[28rem]">
          <span className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3 py-1 font-bold ${getPriorityBadgeClasses(priority)}`}>
            {priorityBand}
          </span>
          <span className="inline-flex min-h-9 items-center justify-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-medium text-blue-700">
            <CalendarDays className="h-3.5 w-3.5" /> {targetDate || formatSuggestedCompletion(suggestedTimescale)}
          </span>
          <span className="inline-flex min-h-9 items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-700">
            <Upload className="h-3.5 w-3.5" /> {evidenceCount} evidence item{evidenceCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
        <span className="font-semibold">Why this priority? </span>
        {getPriorityExplanation(priority)}
      </div>
      {children}
    </div>
  );
}

interface RecommendationCardProps {
  item: RecommendationCardItem;
  onOpen: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}

const normalizeRecommendationLine = (value: string | null | undefined): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export function RecommendationCard({ item, onOpen, onDelete, deleteLabel = 'Delete recommendation' }: RecommendationCardProps) {
  const priorityBand = priorityToBand(item.priority) || '—';
  const hasEvidence = (item.evidenceCount || 0) > 0;
  const primaryText = item.recommendationText || item.findingSummary;
  const secondaryText = item.findingSummary;
  const showSecondaryText = Boolean(
    secondaryText &&
      normalizeRecommendationLine(secondaryText) !== normalizeRecommendationLine(primaryText),
  );

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {item.referenceNumber ? (
              <span className="font-mono text-xs font-semibold text-slate-500">{item.referenceNumber}</span>
            ) : null}
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${getPriorityBadgeClasses(item.priority)}`}>
              {priorityBand}
            </span>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadgeClasses(item.status)}`}>
              {item.status.replace('_', ' ')}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${hasEvidence ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              <FileCheck className="h-3.5 w-3.5" /> {item.evidenceCount || 0} evidence
            </span>
          </div>
          <h4 className="text-sm font-semibold text-slate-900">{primaryText}</h4>
          {showSecondaryText ? (
            <p className="mt-2 line-clamp-2 text-sm text-slate-700">{secondaryText}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>Due: {item.dueDate || 'Not set'}</span>
            {item.sourceLabel ? <span>Linked: {item.sourceLabel}</span> : null}
            <span className="inline-flex items-center gap-1 text-blue-700"><CheckCircle className="h-3.5 w-3.5" /> Open/edit recommendation</span>
          </div>
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 lg:w-auto"
          >
            {deleteLabel}
          </button>
        ) : null}
      </div>
    </article>
  );
}
