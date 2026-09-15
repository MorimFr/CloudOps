import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  AssessmentDefinitionSchema, ControlPackSchema, MAX_ASSESSMENT_DEFINITION_BYTES, MAX_CONTROL_PACK_BYTES,
  type AssessmentDefinition, type AssessmentPlan, type ControlPack,
} from "@cloudops/contracts";
import { defaultEngineRoot, type DiscoveredAssessment } from "./assessment-discovery.js";
import { ControlPackValidationError, validateControlPackPlan } from "./control-pack-validation.js";

export interface RegisteredControlPack {
  readonly assessmentId: string;
  readonly definition: AssessmentDefinition;
  readonly pack: ControlPack;
  readonly plan: AssessmentPlan;
  readonly contentHash: string;
}

export function controlPackContentHash(text: string): string {
  return createHash("sha256").update(text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"), "utf8").digest("hex");
}
function invalid(field: string, reason: string): never { throw new ControlPackValidationError(field, reason); }
function contained(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Reads deployment JSON only; no script imports, code evaluation or runtime payloads. */
function readStaticJson(root: string, segments: readonly string[], maximum: number): { text: string; value: unknown } {
  const field = segments.length === 1 ? "assessment-sdk.json" : "control-packs";
  let descriptor: number | undefined;
  const buffer = Buffer.alloc(maximum + 1);
  try {
    let current = root;
    const rootInfo = lstatSync(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) invalid(field, "plugin directory must not be linked");
    const canonicalRoot = realpathSync(root);
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      const stats = lstatSync(current);
      if (!contained(root, current) || stats.isSymbolicLink()) invalid(field, "linked or escaping path");
      if (index < segments.length - 1) {
        if (!stats.isDirectory()) invalid(field, "parent must be a regular directory");
      } else {
        if (!stats.isFile() || stats.nlink !== 1) invalid(field, "expected regular file without links");
        if (stats.size > maximum) invalid(field, "static JSON exceeds its byte limit");
        if (!contained(canonicalRoot, realpathSync(current))) invalid(field, "resolved path escapes plugin");
        descriptor = openSync(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(descriptor);
        if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== stats.ino || opened.dev !== stats.dev) invalid(field, "file changed during validation");
      }
    }
    let length = 0;
    while (length < buffer.length) {
      const bytes = readSync(descriptor!, buffer, length, buffer.length - length, null);
      if (!bytes) break;
      length += bytes;
    }
    if (length > maximum) invalid(field, "static JSON exceeds its byte limit");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
    return { text, value: JSON.parse(text) as unknown };
  } catch (error) {
    if (error instanceof ControlPackValidationError) throw error;
    return invalid(field, "required static JSON is missing, unreadable or malformed");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    buffer.fill(0);
  }
}

export function discoverControlPacks(
  plugins: readonly DiscoveredAssessment[], engineRoot: string = defaultEngineRoot(),
): readonly RegisteredControlPack[] {
  const registered: RegisteredControlPack[] = [];
  const identities = new Map<string, string>();
  for (const { manifest } of plugins) {
    const root = path.resolve(engineRoot, manifest.id);
    try { lstatSync(path.join(root, "assessment-sdk.json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      invalid("assessment-sdk.json", "definition is unreadable");
    }
    const source = readStaticJson(root, ["assessment-sdk.json"], MAX_ASSESSMENT_DEFINITION_BYTES);
    const definition = AssessmentDefinitionSchema.safeParse(source.value);
    if (!definition.success) invalid("assessment-sdk.json", "invalid strict definition schema or registry references");
    if (definition.data.assessmentId !== manifest.id) invalid("assessmentId", "definition does not match plugin");
    for (const reference of definition.data.controlPacks) {
      const contents = readStaticJson(root, ["control-packs", reference.file], MAX_CONTROL_PACK_BYTES);
      const parsed = ControlPackSchema.safeParse(contents.value);
      if (!parsed.success) invalid("control-packs", "invalid strict control pack schema");
      const pack = parsed.data;
      const contentHash = controlPackContentHash(contents.text);
      if (pack.id !== reference.id || pack.controlPackVersion !== reference.version) invalid("control-packs", "pack identity/version does not match its pinned reference");
      if (reference.sha256 !== contentHash) invalid("control-packs.sha256", "content changed without an approved version pin");
      const identity = `${pack.id}@${pack.controlPackVersion}`;
      if (identities.has(identity) && identities.get(identity) !== contentHash) invalid("control-packs", "same pack version has conflicting content");
      identities.set(identity, contentHash);
      registered.push(Object.freeze({
        assessmentId: manifest.id, definition: definition.data, pack,
        plan: validateControlPackPlan(pack, definition.data, manifest), contentHash,
      }));
    }
  }
  return Object.freeze(registered);
}
