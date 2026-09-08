import type { AssessmentSummary } from "@cloudops/contracts";

export interface CatalogModule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly order: number;
  readonly assessments: AssessmentSummary[];
}

function compareId(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Presentation grouping only. Module membership and labels come from the API. */
export function groupAssessmentsByModule(assessments: readonly AssessmentSummary[]): CatalogModule[] {
  const modules = new Map<string, CatalogModule>();
  for (const assessment of assessments) {
    if (!assessment.enabled) continue;
    let module = modules.get(assessment.moduleId);
    if (!module) {
      module = { id: assessment.moduleId, name: assessment.moduleName, description: assessment.moduleDescription, order: assessment.moduleOrder, assessments: [] };
      modules.set(module.id, module);
    }
    module.assessments.push(assessment);
  }
  for (const module of modules.values()) {
    module.assessments.sort((a, b) => a.assessmentOrder - b.assessmentOrder || compareId(a.id, b.id));
  }
  return [...modules.values()].sort((a, b) => a.order - b.order || compareId(a.id, b.id));
}
