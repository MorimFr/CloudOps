import type { CatalogModule } from "../catalog/modules";
import type { AssessmentExecutionRequest } from "@cloudops/contracts";
import type { PendingConsent } from "../auth/useAssessmentLaunch";
import { AssessmentCard } from "./AssessmentCard";

interface CatalogModuleSectionProps {
  readonly module: CatalogModule;
  readonly busy: boolean;
  readonly consent: PendingConsent | null;
  readonly onExecute: (id: string, options?: AssessmentExecutionRequest["options"]) => void;
}

export function CatalogModuleSection({ module, busy, consent, onExecute }: CatalogModuleSectionProps) {
  if (module.assessments.length === 0) return null;
  return <section className="catalog-module" aria-labelledby={`module-${module.id}`}>
    <header className="module-header">
      <div>
        <p className="eyebrow">Módulo {String(module.order).padStart(2, "0")}</p>
        <h2 id={`module-${module.id}`}>{module.name}</h2>
        <p className="module-description">{module.description}</p>
      </div>
      <span className="module-count">{String(module.assessments.length).padStart(2, "0")} {module.assessments.length === 1 ? "item" : "itens"}</span>
    </header>
    <div className="assessment-grid">
      {module.assessments.map((assessment) => <AssessmentCard key={assessment.id} assessment={assessment} busy={busy}
        permissionState={consent?.assessment.id === assessment.id ? consent.state : "READY"} onExecute={onExecute} />)}
    </div>
  </section>;
}
