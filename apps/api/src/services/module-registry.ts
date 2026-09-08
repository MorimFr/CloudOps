import { AssessmentModuleSchema, type AssessmentModule } from "@cloudops/contracts";

// Taxonomy only: registering an empty module does not create a tool or a card.
const DEFAULT_MODULES: readonly AssessmentModule[] = [
  { id: "security-assessments", name: "Assessments", description: "Avaliações estruturadas da postura de segurança do ambiente.", order: 1, provider: "azure", domain: "secops" },
  { id: "identity-visibility", name: "Visibilidade de segurança de identidade", description: "Consultas diretas para apoiar a operação diária de segurança.", order: 2, provider: "azure", domain: "secops" },
  { id: "protection-response", name: "Proteção e resposta", description: "Capacidades de detecção, investigação e redução de exposição.", order: 3, provider: "azure", domain: "secops" },
  { id: "connectivity-diagnostics", name: "Conectividade e diagnóstico", description: "Validação técnica das conexões e do acesso delegado. Não representa uma avaliação de segurança.", order: 4, provider: "azure", domain: "secops" },
  { id: "runtime-validation", name: "Validação de runtime", description: "Testes de desenvolvimento do pipeline efêmero de execução e relatórios.", order: 1, provider: "azure", domain: "devops" },
];

export class ModuleRegistry {
  readonly #modules = new Map<string, Readonly<AssessmentModule>>();

  constructor(modules: readonly AssessmentModule[] = DEFAULT_MODULES) {
    for (const entry of modules) {
      const module = AssessmentModuleSchema.parse(entry);
      if (this.#modules.has(module.id)) throw new Error("Duplicate module registry entry");
      this.#modules.set(module.id, Object.freeze(module));
    }
  }

  resolve(id: string): Readonly<AssessmentModule> {
    const module = this.#modules.get(id);
    if (!module) throw new Error("Assessment module is not registered");
    return module;
  }
}
