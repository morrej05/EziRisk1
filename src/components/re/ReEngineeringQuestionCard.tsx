import ReRatingPanel from './ReRatingPanel';
import type { AutoRecommendationLifecycleState } from '../../lib/re/recommendations/recommendationPipeline';

interface ReEngineeringQuestionCardProps {
  questionId: string;
  factorKey: string;
  prompt: string;
  rating: number | null;
  notes: string;
  weight?: number;
  autoRecommendationState?: AutoRecommendationLifecycleState;
  onRatingChange: (rating: number) => void;
  onClearRating: () => void;
  onNotesChange: (notes: string) => void;
}

export default function ReEngineeringQuestionCard({
  questionId,
  factorKey,
  prompt,
  rating,
  notes,
  weight = 1,
  autoRecommendationState = 'none',
  onRatingChange,
  onClearRating,
  onNotesChange,
}: ReEngineeringQuestionCardProps) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3 h-full">
      <p className="text-sm font-semibold text-slate-900">{questionId}. {prompt}</p>
      <ReRatingPanel
        canonicalKey={factorKey}
        title={null}
        industryKey={null}
        rating={rating ?? 3}
        onChangeRating={onRatingChange}
        helpText="Rate this fire-protection engineering factor using the 1–5 shared RE scale."
        weight={weight}
        autoRecommendationState={autoRecommendationState}
      />
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
        placeholder="Optional assessor notes"
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />
    </div>
  );
}
