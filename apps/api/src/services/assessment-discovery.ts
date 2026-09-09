import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync,
  readdirSync, realpathSync, type Stats,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AssessmentManifestSchema, MAX_ASSESSMENT_MANIFEST_BYTES, type AssessmentManifest,
} from "@cloudops/contracts";
import { AssessmentManifestError, manifestSchemaError } from "./assessment-manifest-error.js";

export interface DiscoveredAssessment {
  readonly manifest: AssessmentManifest;
  readonly scriptPath: string;
}

export function defaultEngineRoot(): string {
  return fileURLToPath(new URL("../../../../engine/", import.meta.url));
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function inspect(target: string, directory: string, field: string): Stats {
  try { return lstatSync(target); }
  catch { throw new AssessmentManifestError(directory, field, "required path is missing or unreadable"); }
}

function regularFile(target: string, directory: string, field: string): Stats {
  const stats = inspect(target, directory, field);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new AssessmentManifestError(directory, field, "expected regular file without symbolic or hard links");
  }
  return stats;
}

function readManifest(target: string, directory: string): AssessmentManifest {
  const stats = regularFile(target, directory, "manifest");
  if (stats.size > MAX_ASSESSMENT_MANIFEST_BYTES) {
    throw new AssessmentManifestError(directory, "manifest", "file exceeds 64 KiB");
  }
  let descriptor: number | undefined;
  const buffer = Buffer.alloc(MAX_ASSESSMENT_MANIFEST_BYTES + 1);
  try {
    descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== stats.dev || opened.ino !== stats.ino) {
      throw new AssessmentManifestError(directory, "manifest", "file changed during discovery");
    }
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_ASSESSMENT_MANIFEST_BYTES) {
      throw new AssessmentManifestError(directory, "manifest", "file exceeds 64 KiB");
    }
    let json: unknown;
    try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { throw new AssessmentManifestError(directory, "manifest", "expected valid UTF-8 JSON"); }
    const parsed = AssessmentManifestSchema.safeParse(json);
    if (!parsed.success) throw manifestSchemaError(directory, parsed.error);
    return parsed.data;
  } catch (error) {
    if (error instanceof AssessmentManifestError) throw error;
    throw new AssessmentManifestError(directory, "manifest", "file could not be read safely");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    buffer.fill(0);
  }
}

function resolveEntrypoint(root: string, directory: string, manifest: AssessmentManifest): string {
  const pluginRoot = path.join(root, directory);
  let target = pluginRoot;
  const segments = manifest.engine.entrypoint.split("/");
  for (const [index, segment] of segments.entries()) {
    target = path.join(target, segment);
    if (!inside(pluginRoot, target)) throw new AssessmentManifestError(directory, "engine.entrypoint", "path escapes assessment directory");
    if (index === segments.length - 1) regularFile(target, directory, "engine.entrypoint");
    else {
      const stats = inspect(target, directory, "engine.entrypoint");
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new AssessmentManifestError(directory, "engine.entrypoint", "parent must be a directory without links");
      }
    }
  }
  const resolved = realpathSync(target);
  if (!inside(root, resolved) || !inside(pluginRoot, resolved)) {
    throw new AssessmentManifestError(directory, "engine.entrypoint", "resolved path escapes assessment directory");
  }
  return resolved;
}

/** Startup-only discovery of trusted deployment configuration. No script is
 * opened, imported or executed. Keep the deployment immutable after discovery.
 */
export function discoverAssessmentManifests(engineRoot: string = defaultEngineRoot()): readonly DiscoveredAssessment[] {
  let directory = "engine";
  try {
    const configuredRoot = path.resolve(engineRoot);
    const rootStats = inspect(configuredRoot, directory, "engineRoot");
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new AssessmentManifestError(directory, "engineRoot", "expected directory without links");
    }
    const root = realpathSync(configuredRoot);
    const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const plugins: DiscoveredAssessment[] = [];
    const ids = new Set<string>();
    for (const entry of entries) {
      directory = entry.name;
      if (entry.isSymbolicLink()) throw new AssessmentManifestError(directory, "directory", "linked engine entries are not supported");
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(root, directory, "assessment.json");
      try { lstatSync(manifestPath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new AssessmentManifestError(directory, "manifest", "manifest is unreadable");
      }
      const manifest = readManifest(manifestPath, directory);
      if (ids.has(manifest.id)) throw new AssessmentManifestError(directory, "id", "duplicate assessment ID");
      if (directory !== manifest.id) throw new AssessmentManifestError(directory, "id", "directory name must equal assessment ID");
      ids.add(manifest.id);
      plugins.push(Object.freeze({ manifest, scriptPath: resolveEntrypoint(root, directory, manifest) }));
    }
    return Object.freeze(plugins);
  } catch (error) {
    if (error instanceof AssessmentManifestError) throw error;
    throw new AssessmentManifestError(directory, "manifest", "discovery could not complete safely");
  }
}
