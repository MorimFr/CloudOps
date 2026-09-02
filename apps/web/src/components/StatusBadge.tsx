import type { ExecutionStatus } from "@cloudops/contracts";

const STATUS_LABELS: Record<ExecutionStatus, string> = {
  CREATED: "Criada",
  STARTING: "Iniciando",
  RUNNING: "Em execução",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  EXPIRED: "Expirada",
};

interface StatusBadgeProps {
  status: ExecutionStatus;
}

function statusLabel(status: ExecutionStatus): string {
  return STATUS_LABELS[status];
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      <span className="status-dot" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}
