import { X } from 'lucide-react';

export type ActiveFilterChip = {
  key: string;
  label: string;
  value: string;
};

type ActiveFilterChipsProps = {
  chips: ActiveFilterChip[];
  onRemove: (chipKey: string) => void;
  onClearAll?: () => void;
  className?: string;
};

export function ActiveFilterChips({ chips, onRemove, onClearAll, className = '' }: ActiveFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 ${className}`.trim()}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
        >
          <span className="font-medium">{chip.label}:</span>
          <span>{chip.value}</span>
          <button
            type="button"
            onClick={() => onRemove(chip.key)}
            className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            aria-label={`Remove ${chip.label} filter`}
            title={`Remove ${chip.label} filter`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}

      {chips.length >= 2 && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
