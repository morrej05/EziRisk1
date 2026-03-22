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
  if (!isSelected) return 'border-slate-300 bg-white text-slate-700 hover:border-slate-400';
  if (value <= 1) return 'border-red-600 bg-red-50 text-red-900 font-semibold';
  if (value === 2) return 'border-amber-600 bg-amber-50 text-amber-900 font-semibold';
  return 'border-green-600 bg-green-50 text-green-900 font-semibold';
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
  const autoRecHint =
    typeof rating === 'number' && rating <= 2
      ? autoRecommendationState === 'created' || autoRecommendationState === 'updated' || autoRecommendationState === 'restored'
        ? 'Targeted recommendation active'
        : 'Targeted recommendation will be created on save'
      : autoRecommendationState === 'created' || autoRecommendationState === 'updated' || autoRecommendationState === 'restored'
        ? 'Recommendation will be suppressed on save'
        : 'No active recommendation';

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3 h-full">
      <p className="text-sm font-semibold text-slate-900">{questionId}. {title || prompt}</p>
      <p className="text-xs text-slate-600">{prompt}</p>

      <div className="text-xs text-slate-500">Answer scale: 0–4 (observable state based)</div>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {answerStates.map((state) => (
          <button
            key={state.score}
            type="button"
            onClick={() => onRatingChange(state.score)}
            className={`p-2 rounded-lg border-2 text-left ${getRatingButtonStyles(state.score, rating === state.score)}`}
          >
            <div className="text-base font-bold">{state.score}</div>
            <div className="text-[11px] font-semibold">{state.label}</div>
          </button>
        ))}
      </div>

      {typeof rating === 'number' && (
        <div className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700">
          {answerStates.find((s) => s.score === rating)?.description}
        </div>
      )}

      <p className="text-xs text-slate-500">{autoRecHint}</p>
      <button
        type="button"
        onClick={onClearRating}
        className="text-xs text-slate-500 hover:text-slate-700 underline"
      >
        Clear rating
      </button>
      <textarea
        rows={2}
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Optional assessor notes / evidence observed"
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />
    </div>
  );
}
