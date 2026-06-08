import AutoExpandTextarea from '../AutoExpandTextarea';
import type { AutoRecommendationLifecycleState } from '../../lib/re/recommendations/recommendationPipeline';
import type { Re04AnswerStateDefinition } from '../../lib/re/re04EngineeringModel';

interface ReEngineeringQuestionCardProps {
  questionId: string;
  factorKey: string;
  title?: string;
  prompt: string;
  rating: number | null;
  notes: string;
  weight?: number;
  answerStates: Re04AnswerStateDefinition[];
  autoRecommendationState?: AutoRecommendationLifecycleState;
  onRatingChange: (rating: number) => void;
  onClearRating: () => void;
  onNotesChange: (notes: string) => void;
}

function getRatingButtonStyles(value: number, isSelected: boolean): string {
  if (!isSelected) return 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50';
  if (value <= 1) return 'border-red-500 bg-red-50 text-red-900 ring-1 ring-red-400';
  if (value === 2) return 'border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-400';
  return 'border-green-600 bg-green-50 text-green-900 ring-1 ring-green-500';
}

export default function ReEngineeringQuestionCard({
  questionId,
  prompt,
  title,
  rating,
  notes,
  answerStates,
  autoRecommendationState = 'none',
  onRatingChange,
  onClearRating,
  onNotesChange,
}: ReEngineeringQuestionCardProps) {
  const selectedState = typeof rating === 'number' ? answerStates.find((s) => s.score === rating) : undefined;

  const autoRecHint =
    autoRecommendationState === 'created'
      ? 'Targeted recommendation created'
      : autoRecommendationState === 'exists'
        ? 'Targeted recommendation on file'
        : typeof rating === 'number' && rating <= 2
          ? 'Targeted recommendation will be created on save'
          : null;

  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      {/* Question header */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              {questionId}. {title || prompt}
            </p>
            {title && title !== prompt && (
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">{prompt}</p>
            )}
          </div>
          {typeof rating === 'number' && (
            <button
              type="button"
              onClick={onClearRating}
              className="shrink-0 text-xs text-slate-400 hover:text-slate-600 underline mt-0.5"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Rating buttons */}
      <div className="px-5 py-4">
        <div className="flex gap-2">
          {answerStates.map((state) => (
            <button
              key={state.score}
              type="button"
              onClick={() => onRatingChange(state.score)}
              title={state.description}
              className={`flex-1 min-w-0 rounded-lg border-2 px-2 py-2.5 text-left transition-colors ${getRatingButtonStyles(state.score, rating === state.score)}`}
            >
              <div className="text-base font-bold leading-none">{state.score}</div>
              <div className="mt-1 text-[11px] font-medium leading-tight">{state.label}</div>
            </button>
          ))}
        </div>

        {selectedState && (
          <p className="mt-2 text-xs text-slate-600 bg-slate-50 rounded px-3 py-2 border border-slate-200">
            {selectedState.description}
          </p>
        )}

        {autoRecHint && (
          <p className={`mt-2 text-xs ${autoRecommendationState === 'none' ? 'text-amber-700' : 'text-sky-700'}`}>
            {autoRecHint}
          </p>
        )}
      </div>

      {/* Notes */}
      <div className="px-5 pb-4">
        <AutoExpandTextarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Assessor notes / evidence observed"
          minRows={4}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>
    </div>
  );
}
