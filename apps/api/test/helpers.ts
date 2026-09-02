import type {
  AssessmentRuntime,
  RuntimeExecutionInput,
  RuntimeExecutionResult,
} from "../src/services/powershell-runtime.js";

export class ImmediateRuntime implements AssessmentRuntime {
  public readonly calls: RuntimeExecutionInput[] = [];
  public readonly artifacts: Buffer[] = [];
  public healthChecks = 0;

  public async execute(
    input: RuntimeExecutionInput,
  ): Promise<RuntimeExecutionResult> {
    this.calls.push(input);
    input.onStarted();
    input.onProgress("PROCESSING", 55);
    input.onProgress("GENERATING_REPORT", 85);
    const artifact = Buffer.from("PK\u0003\u0004fake-zip", "binary");
    this.artifacts.push(artifact);
    return {
      artifact,
      summary: { message: "assessment completed" },
      exitCode: 0,
    };
  }

  public async isAvailable(): Promise<boolean> {
    this.healthChecks += 1;
    return true;
  }
}

export async function waitForCondition(
  condition: () => boolean,
  attempts = 50,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Test condition was not reached");
}
