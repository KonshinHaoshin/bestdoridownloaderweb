import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

type Scope = 'api' | 'live2d' | 'media' | 'all';
type BundleKind = 'model' | 'physics' | 'texture' | 'motion' | 'expression' | 'transition';

type BundleFile = {
  bundleName: string;
  fileName: string;
};

type BuildData = {
  model?: BundleFile;
  physics?: BundleFile;
  textures?: BundleFile[];
  transition?: BundleFile;
  motions?: BundleFile[];
  expressions?: BundleFile[];
};

type CostumeInfo = {
  assetBundleName?: string;
};

type CardInfo = {
  resourceSetName?: string;
  stat?: {
    training?: unknown;
  };
};

type DownloadTask = {
  sourceUrl: string;
  mirrorPath: string;
  optional?: boolean;
};

type FileStatus = 'planned' | 'exists' | 'downloaded' | 'skipped';

type Options = {
  outDir: string;
  apiBase: string;
  assetsBase: string;
  scope: Scope;
  concurrency: number;
  retries: number;
  limit?: number;
  models?: string[];
  modelList?: string;
  force: boolean;
  dryRun: boolean;
};

const API_ENDPOINTS = [
  '/characters/all.2.json',
  '/explorer/jp/assets/_info.json',
  '/costumes/all.5.json',
  '/cards/all.5.json',
] as const;

const DEFAULT_OPTIONS: Options = {
  outDir: process.env.BESTDORI_MIRROR_DIR || 'mirror',
  apiBase: process.env.BESTDORI_API_BASE || 'https://bestdori.com/api',
  assetsBase: process.env.BESTDORI_ASSETS_BASE || 'https://bestdori.com/assets',
  scope: 'all',
  concurrency: Number(process.env.BESTDORI_SYNC_CONCURRENCY || 8),
  retries: 3,
  force: false,
  dryRun: false,
};

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const trimSlash = (value: string) => value.replace(/\/+$/, '');
const stripLeadingSlash = (value: string) => value.replace(/^\/+/, '');
const apiMirrorPath = (path: string) => `bestdori-api/${stripLeadingSlash(path)}`;
const assetsMirrorPath = (path: string) => `bestdori-assets/${stripLeadingSlash(path)}`;
const apiUrl = (options: Options, path: string) => `${trimSlash(options.apiBase)}/${stripLeadingSlash(path)}`;
const assetsUrl = (options: Options, path: string) => `${trimSlash(options.assetsBase)}/${stripLeadingSlash(path)}`;

const normalizeModelFileName = (fileName: string) => fileName.replace(/\.bytes$/, '');
const normalizeMotionFileName = (fileName: string) => fileName.replace(/\.bytes$/, '');
const normalizeTextureFileName = (fileName: string) => {
  if (fileName.endsWith('.bytes')) return fileName.replace(/\.bytes$/, '.png');
  return fileName.includes('.') ? fileName : `${fileName}.png`;
};

function normalizeBundleFileName(fileName: string, kind: BundleKind) {
  if (kind === 'model') return normalizeModelFileName(fileName);
  if (kind === 'motion') return normalizeMotionFileName(fileName);
  if (kind === 'texture') return normalizeTextureFileName(fileName);
  return fileName;
}

function parseArgs(argv: string[]): Options {
  const options = { ...DEFAULT_OPTIONS };

  for (const arg of argv) {
    if (arg === '--') continue;
    else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else if (arg.startsWith('--api-base=')) options.apiBase = arg.slice('--api-base='.length);
    else if (arg.startsWith('--assets-base=')) options.assetsBase = arg.slice('--assets-base='.length);
    else if (arg.startsWith('--scope=')) options.scope = parseScope(arg.slice('--scope='.length));
    else if (arg.startsWith('--concurrency=')) options.concurrency = parsePositiveInt(arg.slice('--concurrency='.length), 'concurrency');
    else if (arg.startsWith('--retries=')) options.retries = parsePositiveInt(arg.slice('--retries='.length), 'retries');
    else if (arg.startsWith('--limit=')) options.limit = parsePositiveInt(arg.slice('--limit='.length), 'limit');
    else if (arg.startsWith('--models=')) options.models = parseCsv(arg.slice('--models='.length));
    else if (arg.startsWith('--model-list=')) options.modelList = arg.slice('--model-list='.length);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exitCode = 0;
      return options;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseScope(value: string): Scope {
  if (value === 'api' || value === 'live2d' || value === 'media' || value === 'all') return value;
  throw new Error(`Invalid scope: ${value}`);
}

function parsePositiveInt(value: string, name: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function parseCsv(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function printHelp() {
  console.log(`Usage:
  pnpm sync:bestdori -- --out=mirror
  pnpm sync:bestdori -- --dry-run --limit=3
  pnpm sync:bestdori -- --scope=live2d --models=001_casual,002_casual

Options:
  --out=DIR              Mirror output directory. Default: BESTDORI_MIRROR_DIR or ./mirror
  --scope=api|live2d|media|all
  --concurrency=N        Parallel downloads. Default: 8
  --retries=N            Retries per file. Default: 3
  --limit=N              Only sync first N Live2D models, useful for validation
  --models=a,b,c         Only sync these Live2D model names
  --model-list=FILE      Read model names from a newline-delimited file
  --force                Re-download files that already exist
  --dry-run              Print planned work without writing files`);
}

async function fileExists(path: string) {
  try {
    const result = await stat(path);
    return result.isFile();
  } catch {
    return false;
  }
}

function resolveMirrorPath(options: Options, mirrorPath: string) {
  const root = resolve(options.outDir);
  const target = resolve(root, mirrorPath);
  const rel = relative(root, target);
  if (rel.startsWith('..')) throw new Error(`Refusing to write outside mirror dir: ${mirrorPath}`);
  return target;
}

async function fetchJson<T>(url: string, retries: number): Promise<T> {
  const data = await fetchBytes(url, retries);
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

async function fetchBytes(url: string, retries: number): Promise<Uint8Array> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(500 * attempt);
    }
  }

  throw new Error(`${url} failed after ${retries} attempts: ${String(lastError)}`);
}

async function writeMirrorFile(options: Options, mirrorPath: string, data: string | Uint8Array) {
  if (options.dryRun) return;
  const target = resolveMirrorPath(options, mirrorPath);
  await mkdir(dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${Date.now()}`;
  await writeFile(tempPath, data);
  await rename(tempPath, target);
}

async function syncJson<T>(options: Options, path: string): Promise<T> {
  const sourceUrl = apiUrl(options, path);
  const mirrorPath = apiMirrorPath(path);
  console.log(`[api] ${path}`);
  const data = await fetchJson<T>(sourceUrl, options.retries);
  await writeMirrorFile(options, mirrorPath, JSON.stringify(data));
  return data;
}

function bundleTask(options: Options, file: BundleFile | undefined, kind: BundleKind): DownloadTask | undefined {
  if (!file?.bundleName || !file.fileName) return undefined;
  const fileName = normalizeBundleFileName(file.fileName, kind);
  const assetPath = `/jp/${file.bundleName}_rip/${fileName}`;
  return {
    sourceUrl: assetsUrl(options, assetPath),
    mirrorPath: assetsMirrorPath(assetPath),
    optional: true,
  };
}

function collectBuildDataTasks(options: Options, buildData: BuildData) {
  const tasks: DownloadTask[] = [];
  const push = (task: DownloadTask | undefined) => {
    if (task) tasks.push(task);
  };

  push(bundleTask(options, buildData.model, 'model'));
  push(bundleTask(options, buildData.physics, 'physics'));
  push(bundleTask(options, buildData.transition, 'transition'));
  buildData.textures?.forEach((file) => push(bundleTask(options, file, 'texture')));
  buildData.motions?.forEach((file) => push(bundleTask(options, file, 'motion')));
  buildData.expressions?.forEach((file) => push(bundleTask(options, file, 'expression')));
  return tasks;
}

function collectMediaTasks(options: Options, costumes: Record<string, CostumeInfo>, cards: Record<string, CardInfo>) {
  const tasks: DownloadTask[] = [];

  for (const [id, costume] of Object.entries(costumes)) {
    if (!costume?.assetBundleName) continue;
    const costumeId = Number(id);
    const group = Number.isFinite(costumeId) ? Math.floor(costumeId / 50) : 0;
    const path = `/jp/thumb/costume/group${group}_rip/${costume.assetBundleName}.png`;
    tasks.push({ sourceUrl: assetsUrl(options, path), mirrorPath: assetsMirrorPath(path), optional: true });
  }

  for (const card of Object.values(cards)) {
    if (!card?.resourceSetName) continue;
    const basePath = `/jp/characters/resourceset/${card.resourceSetName}_rip`;
    tasks.push({
      sourceUrl: assetsUrl(options, `${basePath}/card_normal.png`),
      mirrorPath: assetsMirrorPath(`${basePath}/card_normal.png`),
      optional: true,
    });
    if (card.stat?.training) {
      tasks.push({
        sourceUrl: assetsUrl(options, `${basePath}/card_after_training.png`),
        mirrorPath: assetsMirrorPath(`${basePath}/card_after_training.png`),
        optional: true,
      });
    }
  }

  return tasks;
}

async function loadModelAllowList(options: Options) {
  const names = new Set(options.models || []);
  if (options.modelList) {
    const content = await readFile(options.modelList, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) names.add(trimmed);
    }
  }
  return names.size ? names : undefined;
}

function selectModels(assetsIndex: unknown, allowList: Set<string> | undefined, limit: number | undefined) {
  const live2dChara = (assetsIndex as { live2d?: { chara?: Record<string, unknown> } }).live2d?.chara || {};
  let models = Object.keys(live2dChara).filter((name) => !name.endsWith('general')).sort();
  if (allowList) models = models.filter((name) => allowList.has(name));
  if (limit) models = models.slice(0, limit);
  return models;
}

function dedupeTasks(tasks: DownloadTask[]) {
  const byPath = new Map<string, DownloadTask>();
  for (const task of tasks) byPath.set(task.mirrorPath, task);
  return Array.from(byPath.values()).sort((a, b) => a.mirrorPath.localeCompare(b.mirrorPath));
}

function appendMany<T>(target: T[], values: T[]) {
  for (const value of values) target.push(value);
}

async function downloadTask(options: Options, task: DownloadTask) {
  const target = resolveMirrorPath(options, task.mirrorPath);
  if (!options.force && await fileExists(target)) return 'exists';
  if (options.dryRun) return 'planned';

  try {
    const data = await fetchBytes(task.sourceUrl, options.retries);
    await writeMirrorFile(options, task.mirrorPath, data);
    return 'downloaded';
  } catch (error) {
    if (task.optional) {
      console.warn(`[skip optional] ${task.sourceUrl}: ${String(error)}`);
      return 'skipped';
    }
    throw error;
  }
}

async function syncBuildData(options: Options, modelName: string) {
  const path = `/jp/live2d/chara/${modelName}_rip/buildData.asset`;
  const mirrorPath = assetsMirrorPath(path);
  const target = resolveMirrorPath(options, mirrorPath);
  let status: FileStatus = 'downloaded';
  let data: Uint8Array;

  if (!options.force && !options.dryRun && await fileExists(target)) {
    data = await readFile(target);
    status = 'exists';
  } else {
    data = await fetchBytes(assetsUrl(options, path), options.retries);
    if (options.dryRun) {
      status = 'planned';
    } else {
      await writeMirrorFile(options, mirrorPath, data);
    }
  }

  const buildDataAsset = JSON.parse(new TextDecoder().decode(data)) as { Base?: BuildData };
  if (!buildDataAsset.Base) {
    console.warn(`[live2d] missing Base in ${modelName}`);
    return { modelName, status, tasks: [] as DownloadTask[] };
  }

  return {
    modelName,
    status,
    tasks: collectBuildDataTasks(options, buildDataAsset.Base),
  };
}

async function collectLive2dTasks(options: Options, models: string[]) {
  let next = 0;
  let done = 0;
  const tasks: DownloadTask[] = [];
  const syncedModels: string[] = [];
  const counts: Record<FileStatus, number> = {
    planned: 0,
    exists: 0,
    downloaded: 0,
    skipped: 0,
  };

  const workers = Array.from({ length: Math.min(options.concurrency, models.length) }, async () => {
    while (next < models.length) {
      const modelName = models[next++];
      const result = await syncBuildData(options, modelName);
      counts[result.status]++;
      tasks.push(...result.tasks);
      if (result.tasks.length) syncedModels.push(result.modelName);
      done++;
      if (done % 50 === 0 || done === models.length) {
        console.log(`[live2d] buildData ${done}/${models.length} done`);
      }
    }
  });

  await Promise.all(workers);
  return { tasks, syncedModels, counts };
}

async function runQueue(options: Options, tasks: DownloadTask[]) {
  let next = 0;
  let done = 0;
  const counts: Record<FileStatus, number> = {
    planned: 0,
    exists: 0,
    downloaded: 0,
    skipped: 0,
  };

  const workers = Array.from({ length: Math.min(options.concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      const status = await downloadTask(options, task);
      counts[status]++;
      done++;
      if (done % 50 === 0 || done === tasks.length) {
        console.log(`[files] ${done}/${tasks.length} done`);
      }
    }
  });

  await Promise.all(workers);
  return counts;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (process.exitCode === 0) return;

  const shouldSyncApi = options.scope === 'api' || options.scope === 'all' || options.scope === 'live2d' || options.scope === 'media';
  const shouldSyncLive2d = options.scope === 'live2d' || options.scope === 'all';
  const shouldSyncMedia = options.scope === 'media' || options.scope === 'all';

  console.log(`[mirror] out=${resolve(options.outDir)} scope=${options.scope} concurrency=${options.concurrency}`);
  if (options.dryRun) console.log('[mirror] dry-run mode: no files will be written');

  let assetsIndex: unknown = {};
  let costumes: Record<string, CostumeInfo> = {};
  let cards: Record<string, CardInfo> = {};

  if (shouldSyncApi) {
    const [charactersResult, assetsResult, costumesResult, cardsResult] = await Promise.all([
      syncJson<unknown>(options, API_ENDPOINTS[0]),
      syncJson<unknown>(options, API_ENDPOINTS[1]),
      syncJson<Record<string, CostumeInfo>>(options, API_ENDPOINTS[2]),
      syncJson<Record<string, CardInfo>>(options, API_ENDPOINTS[3]),
    ]);
    void charactersResult;
    assetsIndex = assetsResult;
    costumes = costumesResult;
    cards = cardsResult;
  }

  const tasks: DownloadTask[] = [];
  const syncedModels: string[] = [];
  let buildDataCounts: Record<FileStatus, number> | undefined;

  if (shouldSyncLive2d) {
    const allowList = await loadModelAllowList(options);
    const models = selectModels(assetsIndex, allowList, options.limit);
    console.log(`[live2d] models=${models.length}`);
    const live2dResult = await collectLive2dTasks(options, models);
    appendMany(tasks, live2dResult.tasks);
    appendMany(syncedModels, live2dResult.syncedModels);
    buildDataCounts = live2dResult.counts;
  }

  if (shouldSyncMedia) {
    appendMany(tasks, collectMediaTasks(options, costumes, cards));
  }

  const dedupedTasks = dedupeTasks(tasks);
  console.log(`[files] unique=${dedupedTasks.length}`);
  const counts = await runQueue(options, dedupedTasks);

  const manifest = {
    generatedAt: new Date().toISOString(),
    apiBase: options.apiBase,
    assetsBase: options.assetsBase,
    scope: options.scope,
    dryRun: options.dryRun,
    live2dModels: syncedModels.length,
    buildDataFiles: buildDataCounts,
    files: {
      unique: dedupedTasks.length,
      ...counts,
    },
  };
  await writeMirrorFile(options, 'manifest.json', JSON.stringify(manifest, null, 2));
  console.log(`[done] ${JSON.stringify(manifest.files)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
