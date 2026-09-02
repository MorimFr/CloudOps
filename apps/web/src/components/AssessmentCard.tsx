interface AssessmentCardProps {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  busy?: boolean;
  onExecute: (assessmentId: string) => void;
}

export function AssessmentCard({
  id,
  name,
  description,
  enabled,
  busy = false,
  onExecute,
}: AssessmentCardProps) {
  const unavailable = !enabled;

  return (
    <article className="assessment-card" aria-labelledby={`assessment-${id}`}>
      <div className="card-topline">
        <span className="assessment-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 2.5 20 6v5.2c0 5.1-3.3 8.9-8 10.3-4.7-1.4-8-5.2-8-10.3V6l8-3.5Z" />
            <path d="m8.5 12 2.2 2.2 4.8-5" />
          </svg>
        </span>
        <span className={`availability ${enabled ? "available" : "unavailable"}`}>
          {enabled ? "Disponível" : "Indisponível"}
        </span>
      </div>

      <div className="card-content">
        <p className="assessment-kind">Validação de runtime</p>
        <h3 id={`assessment-${id}`}>{name}</h3>
        <p>{description}</p>
      </div>

      <div className="card-footer">
        <code>{id}</code>
        <button
          className="button button-secondary"
          type="button"
          disabled={unavailable || busy}
          aria-label={`Executar ${name}`}
          onClick={() => onExecute(id)}
        >
          {busy ? "Em execução" : "Executar"}
          {!busy && <span aria-hidden="true">→</span>}
        </button>
      </div>
    </article>
  );
}
