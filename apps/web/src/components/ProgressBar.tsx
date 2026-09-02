interface ProgressBarProps {
  value: number;
  label?: string;
}

function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

export function ProgressBar({
  value,
  label = "Progresso da avaliação",
}: ProgressBarProps) {
  const progress = normalizeProgress(value);

  return (
    <div className="progress-block">
      <div className="progress-meta" aria-hidden="true">
        <span>{label}</span>
        <strong>{progress}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${progress}% concluído`}
      >
        <span
          className="progress-value"
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
