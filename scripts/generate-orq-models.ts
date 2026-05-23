/**
 * One-off script to (re-)generate orq.ai provider model TOML files for models.dev.
 *
 * Usage:
 *   cd /path/to/models.dev
 *   bun scripts/generate-orq-models.ts
 *
 * Prerequisites:
 *   - The orquesta-web repo must be checked out at ../orquesta-web relative to
 *     the models.dev root (i.e. the sibling directory). Adjust ORQ_WEB_MODELS and
 *     DOCS_MDX constants below if the path differs.
 *
 * What it does:
 *   1. Parses the public supported-models.mdx doc to get the canonical model list.
 *   2. For each model, looks up its spec in the orquesta-web TypeScript model files.
 *   3. Skips models where is_active === false.
 *   4. Writes providers/orq/models/{provider}/{model-id}.toml:
 *      - [extends] pointing to the concrete canonical in models.dev when one exists.
 *      - Full TOML spec from orquesta-web TS data otherwise.
 *
 * After running, validate with:
 *   bun run validate
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";

const MODELS_DEV = join(import.meta.dir, "..");
const ORQ_WEB_MODELS =
  "/Users/stefanmikolajczyk/visusolis/clients/orq.ai/source/orquesta-web/apps/cronjobs/master-data/src/models/providers";
const DOCS_MDX =
  "/Users/stefanmikolajczyk/visusolis/clients/orq.ai/source/orquesta-web/documentation/mintlify/docs/proxy/supported-models.mdx";
const ORQ_OUTPUT = join(MODELS_DEV, "providers/orq/models");

// Map orq doc prefix → { tsDir in orquesta-web, mdProvider in models.dev }
const PROVIDER_CONFIG: Record<string, { tsDir: string; mdProvider: string | null }> = {
  alibaba:      { tsDir: "alibaba",     mdProvider: "alibaba" },
  anthropic:    { tsDir: "anthropic",   mdProvider: "anthropic" },
  aws:          { tsDir: "aws",         mdProvider: "amazon-bedrock" },
  azure:        { tsDir: "azure",       mdProvider: "azure" },
  bytedance:    { tsDir: "bytedance",   mdProvider: null },
  cerebras:     { tsDir: "cerebras",    mdProvider: "cerebras" },
  cohere:       { tsDir: "cohere",      mdProvider: "cohere" },
  contextualai: { tsDir: "contextualai",mdProvider: null },
  deepseek:     { tsDir: "deepseek",    mdProvider: "deepseek" },
  elevenlabs:   { tsDir: "elevenlabs",  mdProvider: null },
  fal:          { tsDir: "fal",         mdProvider: null },
  google:       { tsDir: "google",      mdProvider: "google-vertex" }, // Claude → google-vertex-anthropic
  "google-ai":  { tsDir: "googleai",    mdProvider: "google" },
  groq:         { tsDir: "groq",        mdProvider: "groq" },
  hcompany:     { tsDir: "hcompany",    mdProvider: null },
  inceptron:    { tsDir: "inceptron",   mdProvider: null },
  jina:         { tsDir: "jina",        mdProvider: null },
  leonardoai:   { tsDir: "leonardoai",  mdProvider: null },
  minimax:      { tsDir: "minimax",     mdProvider: "minimax" },
  mistral:      { tsDir: "mistral",     mdProvider: "mistral" },
  moonshotai:   { tsDir: "moonshotai",  mdProvider: "moonshotai" },
  openai:       { tsDir: "openai",      mdProvider: "openai" },
  perplexity:   { tsDir: "perplexity",  mdProvider: "perplexity" },
  replicate:    { tsDir: "replicate",   mdProvider: null },
  scaleway:     { tsDir: "scaleway",    mdProvider: "scaleway" },
  tensorix:     { tsDir: "tensorix",    mdProvider: null },
  togetherai:   { tsDir: "together",    mdProvider: "togetherai" },
  xai:          { tsDir: "xai",         mdProvider: "xai" },
  zai:          { tsDir: "zai",         mdProvider: "zai" },
};

// ──────────────────────────────────────────────
// MDX parsing
// ──────────────────────────────────────────────

function parseModelIds(content: string): string[] {
  const regex = /`([a-z][a-z0-9_\-.]*\/[^`\s]+)`/g;
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const id = m[1];
    if (!id.includes("://") && !id.startsWith("$")) ids.add(id);
  }
  return [...ids];
}

// ──────────────────────────────────────────────
// orquesta-web TypeScript index
// ──────────────────────────────────────────────

interface ModelData {
  model_id: string;
  is_active: boolean;
  display_name: string | null;
  created: string | null;
  updated: string | null;
  model_developer: string | null;
  context_window: number | null;
  max_output_tokens: number | null;
  million_tokens_input_cost: number | null;
  million_tokens_output_cost: number | null;
  million_tokens_cache_read_cost: number | null;
  million_tokens_cache_write_cost: number | null;
  supports_tool_calling: boolean | null;
  supports_reasoning: boolean | null;
  supports_structured_outputs: boolean | null;
  supports_vision: boolean | null;
  supports_image_input: boolean | null;
  supports_pdf_input: boolean | null;
  supports_audio_input: boolean | null;
  supports_audio_output: boolean | null;
  supports_video_input: boolean | null;
  supports_text_input: boolean | null;
  supports_text_output: boolean | null;
  knowledge_cutoff: string | null;
}

function parseTs(content: string): ModelData | null {
  const str = (field: string) => {
    const m = content.match(new RegExp(`${field}:\\s*'([^']*)'`));
    return m ? m[1] : null;
  };
  const bool = (field: string): boolean | null => {
    const m = content.match(new RegExp(`${field}:\\s*(true|false)`));
    return m ? m[1] === "true" : null;
  };
  const num = (field: string): number | null => {
    const m = content.match(new RegExp(`${field}:\\s*(\\d+(?:\\.\\d+)?)`));
    return m ? parseFloat(m[1]) : null;
  };

  const model_id = str("model_id");
  if (!model_id) return null;

  const activeMatch = content.match(/is_active:\s*(true|false)/);
  const is_active = activeMatch ? activeMatch[1] === "true" : true;

  return {
    model_id,
    is_active,
    display_name: str("display_name"),
    created: str("created"),
    updated: str("updated"),
    model_developer: str("model_developer"),
    context_window: num("context_window"),
    max_output_tokens: num("max_output_tokens"),
    million_tokens_input_cost: num("million_tokens_input_cost"),
    million_tokens_output_cost: num("million_tokens_output_cost"),
    million_tokens_cache_read_cost: num("million_tokens_cache_read_cost"),
    million_tokens_cache_write_cost: num("million_tokens_cache_write_cost"),
    supports_tool_calling: bool("supports_tool_calling"),
    supports_reasoning: bool("supports_reasoning"),
    supports_structured_outputs: bool("supports_structured_outputs"),
    supports_vision: bool("supports_vision"),
    supports_image_input: bool("supports_image_input"),
    supports_pdf_input: bool("supports_pdf_input"),
    supports_audio_input: bool("supports_audio_input"),
    supports_audio_output: bool("supports_audio_output"),
    supports_video_input: bool("supports_video_input"),
    supports_text_input: bool("supports_text_input"),
    supports_text_output: bool("supports_text_output"),
    knowledge_cutoff: str("knowledge_cutoff"),
  };
}

function buildIndex(): Map<string, ModelData> {
  const index = new Map<string, ModelData>();

  function scanDir(dir: string, providerKey: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        scanDir(full, providerKey);
      } else if (e.name.endsWith(".ts") && e.name !== "index.ts") {
        try {
          const data = parseTs(readFileSync(full, "utf-8"));
          if (data) {
            index.set(`${providerKey}/${data.model_id}`, data);
          }
        } catch {}
      }
    }
  }

  for (const [orqPrefix, cfg] of Object.entries(PROVIDER_CONFIG)) {
    scanDir(join(ORQ_WEB_MODELS, cfg.tsDir), orqPrefix);
  }

  return index;
}

// ──────────────────────────────────────────────
// models.dev canonical lookup
// ──────────────────────────────────────────────

function modelsDir(provider: string): string {
  return join(MODELS_DEV, "providers", provider, "models");
}

/**
 * Case-sensitive lookup for a TOML file. On macOS (case-insensitive FS), existsSync
 * can match the wrong case. We list the directory and compare filenames explicitly.
 * Returns the actual filename stem (without .toml) if found, null otherwise.
 */
function findActualFilename(dir: string, name: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const target = name + ".toml";
  const match = entries.find((e) => e === target);
  return match ? name : null;
}

/**
 * Case-sensitive check for a canonical model. Returns the exact modelPath (with correct
 * casing) if found, null otherwise.
 */
function canonicalExact(provider: string, modelPath: string): string | null {
  const parts = modelPath.split("/");
  const leaf = parts[parts.length - 1];
  const dir = join(modelsDir(provider), ...parts.slice(0, -1));
  const found = findActualFilename(dir, leaf);
  if (!found) return null;
  return [...parts.slice(0, -1), found].join("/") || found;
}

/**
 * Read the extends.from of a canonical TOML file, if it is itself an [extends] file.
 * Returns { provider, modelPath } of the upstream, or null if it's a concrete file.
 *
 * Used to avoid chaining extends → extends (validation resolves in a single pass).
 */
function getExtendsFrom(provider: string, modelPath: string): { provider: string; modelPath: string } | null {
  const filePath = join(modelsDir(provider), modelPath + ".toml");
  try {
    const content = readFileSync(filePath, "utf-8");
    const m = content.match(/\[extends\][^[]*from\s*=\s*"([^/]+)\/([^"]+)"/s);
    if (!m) return null;
    return { provider: m[1], modelPath: m[2] };
  } catch {
    return null;
  }
}

/**
 * Check whether a file at providers/{provider}/models/{modelPath}.toml is itself
 * an [extends] file. If it is, we can't safely chain through it (single-pass resolution).
 */
function isExtendsFile(provider: string, modelPath: string): boolean {
  return getExtendsFrom(provider, modelPath) !== null;
}

/**
 * Try to find a canonical for the model. Falls back to @-suffixed variants
 * (e.g., claude-opus-4-6 → claude-opus-4-6@default.toml).
 *
 * Returns null for nested paths (model IDs with /) because extends.from only
 * allows a single slash (provider/model-id).
 */
function findCanonical(
  provider: string,
  modelPath: string
): { provider: string; modelPath: string } | null {
  // extends.from regex requires exactly one slash — nested paths not allowed.
  if (modelPath.includes("/")) return null;

  const exact = canonicalExact(provider, modelPath);
  if (exact) {
    return { provider, modelPath: exact };
  }

  // Fallback: look for files matching "{modelPath}@*.toml" in the models dir.
  // Handles claude-opus-4-6 → claude-opus-4-6@default or @20250514 etc.
  if (!modelPath.includes("@")) {
    const parts = modelPath.split("/");
    const leaf = parts[parts.length - 1];
    const subDir = join(modelsDir(provider), ...parts.slice(0, -1));
    let candidates: string[] = [];
    try {
      candidates = readdirSync(subDir).filter(
        (f) => f.startsWith(leaf + "@") && f.endsWith(".toml")
      );
    } catch {}

    if (candidates.length > 0) {
      // Prefer @default; otherwise take the first alphabetically.
      const chosen = candidates.find((c) => c.includes("@default")) ?? candidates[0];
      const versionedPath = [...parts.slice(0, -1), chosen.replace(/\.toml$/, "")].join("/");
      return { provider, modelPath: versionedPath };
    }
  }

  return null;
}

function getCanonical(
  orqPrefix: string,
  modelId: string
): { provider: string; modelPath: string } | null {
  // Special: google/ prefix wraps Vertex AI.
  // Claude models → try google-vertex-anthropic, then fall through to anthropic.
  // Gemini/other models → try google-vertex, then fall through to google.
  // IMPORTANT: if the found canonical is itself an [extends] file, follow it one
  // level deeper to the concrete canonical (validation can't chain extends → extends).
  if (orqPrefix === "google") {
    const firstSegment = modelId.split("/")[0];
    if (firstSegment.startsWith("claude")) {
      const gva = findCanonical("google-vertex-anthropic", modelId);
      if (gva) {
        const upstream = getExtendsFrom(gva.provider, gva.modelPath);
        if (!upstream) return gva; // concrete
        // Follow upstream to anthropic canonical.
        return findCanonical(upstream.provider, upstream.modelPath) ?? upstream;
      }
      // Not in google-vertex-anthropic — try anthropic directly.
      const direct = findCanonical("anthropic", modelId);
      if (direct) return direct;
      // For pinned @VERSION Vertex IDs (e.g. claude-opus-4@20250514),
      // try the anthropic canonical with @ replaced by - (e.g. claude-opus-4-20250514).
      if (modelId.includes("@")) {
        return findCanonical("anthropic", modelId.replace("@", "-"));
      }
      return null;
    }
    const gv = findCanonical("google-vertex", modelId);
    if (gv) {
      const upstream = getExtendsFrom(gv.provider, gv.modelPath);
      if (!upstream) return gv; // concrete
      return findCanonical(upstream.provider, upstream.modelPath) ?? upstream;
    }
    // Fall through to direct google canonical.
    return findCanonical("google", modelId);
  }

  const cfg = PROVIDER_CONFIG[orqPrefix];
  if (!cfg?.mdProvider) return null;
  const found = findCanonical(cfg.mdProvider, modelId);
  if (!found) return null;
  // If the found canonical is itself an extends file, follow it one level to the
  // concrete upstream (validation doesn't support chained extends).
  const upstream = getExtendsFrom(found.provider, found.modelPath);
  if (upstream) {
    return findCanonical(upstream.provider, upstream.modelPath) ?? upstream;
  }
  return found;
}

// ──────────────────────────────────────────────
// Full TOML generation (for models without a canonical)
// ──────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "2024-01";
  const m = iso.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : "2024-01";
}

/** Returns null if the model lacks required limit data (context + output tokens). */
function generateFullToml(d: ModelData): string | null {
  if (!d.context_window || !d.max_output_tokens) return null;

  const attachment = !!(
    d.supports_image_input || d.supports_vision || d.supports_pdf_input ||
    d.supports_audio_input || d.supports_video_input
  );
  const inputMods: string[] = [];
  if (d.supports_text_input !== false) inputMods.push("text");
  if (d.supports_image_input || d.supports_vision) inputMods.push("image");
  if (d.supports_audio_input) inputMods.push("audio");
  if (d.supports_video_input) inputMods.push("video");
  if (d.supports_pdf_input) inputMods.push("pdf");

  const outputMods: string[] = [];
  if (d.supports_text_output !== false) outputMods.push("text");
  if (d.supports_audio_output) outputMods.push("audio");

  // Avoid using a display_name that is just a model-ID path (contains /).
  const displayName = (d.display_name && !d.display_name.includes("/")) ? d.display_name : d.model_id;

  let t = `name = "${displayName}"\n`;
  t += `attachment = ${attachment}\n`;
  t += `reasoning = ${d.supports_reasoning ?? false}\n`;
  t += `tool_call = ${d.supports_tool_calling ?? false}\n`;
  if (d.supports_structured_outputs != null)
    t += `structured_output = ${d.supports_structured_outputs}\n`;
  t += `temperature = true\n`;
  if (d.knowledge_cutoff) t += `knowledge = "${fmtDate(d.knowledge_cutoff)}"\n`;
  t += `release_date = "${fmtDate(d.created)}"\n`;
  t += `last_updated = "${fmtDate(d.updated ?? d.created)}"\n`;
  t += `open_weights = false\n`;

  // Include cost section when we have pricing data; input and output are both required by schema.
  if (d.million_tokens_input_cost != null) {
    t += `\n[cost]\n`;
    t += `input = ${d.million_tokens_input_cost}\n`;
    t += `output = ${d.million_tokens_output_cost ?? 0}\n`;
    if (d.million_tokens_cache_read_cost) t += `cache_read = ${d.million_tokens_cache_read_cost}\n`;
    if (d.million_tokens_cache_write_cost) t += `cache_write = ${d.million_tokens_cache_write_cost}\n`;
  }

  t += `\n[limit]\n`;
  t += `context = ${d.context_window}\n`;
  t += `output = ${d.max_output_tokens}\n`;

  t += `\n[modalities]\n`;
  t += `input = [${inputMods.map((m) => `"${m}"`).join(", ")}]\n`;
  t += `output = [${outputMods.map((m) => `"${m}"`).join(", ")}]\n`;

  return t;
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

console.log("Building orquesta-web model index…");
const index = buildIndex();
console.log(`  Indexed ${index.size} models`);

console.log("Parsing model list from docs…");
const mdxContent = readFileSync(DOCS_MDX, "utf-8");
const allIds = parseModelIds(mdxContent);
console.log(`  Found ${allIds.length} model IDs (before dedup)`);

// Deduplicate — Responses API and Chat sections list the same models.
const uniqueIds = [...new Set(allIds)];
console.log(`  ${uniqueIds.length} unique IDs\n`);

const stats = { extends: 0, fullToml: 0, skippedNoProvider: 0, skippedInactive: 0, skippedNoData: 0 };
const noCanonicalLog: string[] = [];
const noDataLog: string[] = [];

for (const fullId of uniqueIds) {
  const slash = fullId.indexOf("/");
  const orqPrefix = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);

  const cfg = PROVIDER_CONFIG[orqPrefix];

  // Skip providers we explicitly don't have canonicals for AND no TS data matters.
  if (!cfg) {
    stats.skippedNoProvider++;
    continue;
  }

  // Check active status from orquesta-web index.
  const tsKey = `${orqPrefix}/${modelId}`;
  const tsData = index.get(tsKey);
  if (tsData?.is_active === false) {
    stats.skippedInactive++;
    continue;
  }

  // Determine output path (first segment = orq provider, rest = model path).
  const modelPathParts = modelId.split("/");
  const outputFile = join(ORQ_OUTPUT, orqPrefix, ...modelPathParts) + ".toml";
  mkdirSync(dirname(outputFile), { recursive: true });

  // Try to find canonical in models.dev.
  const canonical = getCanonical(orqPrefix, modelId);

  if (canonical) {
    writeFileSync(outputFile, `[extends]\nfrom = "${canonical.provider}/${canonical.modelPath}"\n`);
    stats.extends++;
  } else if (cfg.mdProvider === null) {
    // No canonical provider → need full TOML from TS data.
    if (tsData) {
      const toml = generateFullToml(tsData);
      if (toml) {
        writeFileSync(outputFile, toml);
        stats.fullToml++;
      } else {
        noDataLog.push(`${fullId} (missing context_window/max_output_tokens)`);
        stats.skippedNoData++;
      }
    } else {
      noDataLog.push(fullId);
      stats.skippedNoData++;
    }
  } else {
    // Has a canonical provider but model not found → generate full TOML or log.
    if (tsData) {
      const toml = generateFullToml(tsData);
      if (toml) {
        writeFileSync(outputFile, toml);
        noCanonicalLog.push(`  ${fullId} → ${cfg.mdProvider} (no canonical; wrote full TOML)`);
        stats.fullToml++;
      } else {
        noDataLog.push(`${fullId} (missing context_window/max_output_tokens)`);
        stats.skippedNoData++;
      }
    } else {
      noDataLog.push(fullId);
      stats.skippedNoData++;
    }
  }
}

console.log("Results:");
console.log(`  extends:          ${stats.extends}`);
console.log(`  full TOML:        ${stats.fullToml}`);
console.log(`  skipped inactive: ${stats.skippedInactive}`);
console.log(`  skipped no provider: ${stats.skippedNoProvider}`);
console.log(`  skipped no data:  ${stats.skippedNoData}`);

if (noCanonicalLog.length) {
  console.log(`\nModels without canonical (full TOML written):`);
  noCanonicalLog.forEach((l) => console.log(l));
}
if (noDataLog.length) {
  console.log(`\nModels skipped (no TS data found):`);
  noDataLog.forEach((l) => console.log(`  ${l}`));
}

const total = stats.extends + stats.fullToml;
console.log(`\nTotal files written: ${total}`);
