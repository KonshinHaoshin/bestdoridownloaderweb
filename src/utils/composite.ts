import axios from 'axios';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display-webgal/cubism2';
import { CHARACTER_ALIASES } from '../data/characterAliases';
import { PART_PRESETS } from '../data/partPresets';
import {
  BuildData,
  BundleFile,
  CompositeLayerDraft,
  CompositeManifest,
  CompositeSummary,
  ModelPartOpacity,
  PartCategory,
  PreparedCompositeLayer,
} from '../types';
import { getAssetsBase } from '../config';
import {
  bundleAssetUrl,
  normalizeMotionFileName,
  normalizeTextureFileName,
} from './assets';

(window as any).PIXI = PIXI;

const PART_RE = /^PARTS_/i;

const safeSegment = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'model';

const selectorSegment = (value: string) =>
  safeSegment(value).toLowerCase();

const characterIdFromModelName = (modelName: string) => {
  const raw = modelName.slice(0, 3);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? String(parsed) : raw.replace(/^0+/, '') || raw;
};

const englishNameLastToken = (names: string[] = []) => {
  const englishName = names
    .map((name) => name.trim())
    .find((name) => /^[A-Za-z][A-Za-z .'-]* [A-Za-z][A-Za-z .'-]*$/.test(name));
  return englishName?.split(/\s+/).pop();
};

export const getCompositeLayerSelectorPrefix = (modelName: string, characterNames: string[] = []) => {
  const charaId = characterIdFromModelName(modelName);
  const englishLastName = englishNameLastToken(characterNames);
  if (englishLastName) return selectorSegment(englishLastName);

  const aliases = CHARACTER_ALIASES[charaId] || CHARACTER_ALIASES[modelName.slice(0, 3)] || [];
  const asciiFullAlias = aliases.find((alias) => /^[A-Za-z][A-Za-z .'-]* [A-Za-z][A-Za-z .'-]*$/.test(alias.trim()));
  const asciiAlias = asciiFullAlias?.split(/\s+/).pop() || aliases.find((alias) => /^[a-z][a-z0-9_-]*$/i.test(alias.trim()));
  return selectorSegment(asciiAlias || charaId || modelName);
};

const selectorName = (prefix: string | undefined, name: string) =>
  prefix ? `${prefix}/${name}` : name;

const textDataUrl = (mime: string, text: string) =>
  `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;

type CompositeSelectorAsset = {
  selector: string;
  asset: BundleFile;
};

const motionKey = (fileName: string) => {
  const last = fileName.split('/').pop() || 'idle';
  return last.replace(/\.bytes$/, '').replace(/\.mtn$/, '');
};

const expressionKey = (fileName: string) =>
  (fileName.split('/').pop() || '').replace(/\.exp\.json$/, '');

const IMPORT_PARAM_ID = 'PARAM_IMPORT';

const isImportParamId = (value: unknown) =>
  typeof value === 'string' && value.trim().toUpperCase() === IMPORT_PARAM_ID;

export const stripImportFromMotionText = (text: string) =>
  text.replace(/^[\t ]*PARAM_IMPORT\s*=.*(?:\r?\n|$)/gim, '');

const stripImportFromExpressionValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripImportFromExpressionValue(item))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (['id', 'Id', 'ID', 'param', 'Param', 'parameterId', 'ParameterId'].some((key) => isImportParamId(record[key]))) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !isImportParamId(key))
      .map(([key, entry]) => [key, stripImportFromExpressionValue(entry)])
      .filter(([, entry]) => entry !== undefined)
  );
};

export const stripImportFromExpressionJson = (expression: unknown) =>
  stripImportFromExpressionValue(expression);

export const createLive2dModelSettings = (
  modelName: string,
  buildData: BuildData,
  initOpacities?: ModelPartOpacity[]
) => {
  const settings: Record<string, unknown> = {
    url: `${getAssetsBase()}/jp/live2d/chara/${modelName}_rip/buildData.asset`,
    model: bundleAssetUrl(buildData.model, 'model'),
    textures: buildData.textures.map((texture) => bundleAssetUrl(texture, 'texture')),
    physics: bundleAssetUrl(buildData.physics, 'physics'),
    motions: buildData.motions.reduce((acc: Record<string, Array<{ file: string }>>, motion) => {
      const key = motionKey(motion.fileName) || 'idle';
      acc[key] = [{ file: bundleAssetUrl(motion, 'motion') }];
      return acc;
    }, {}),
    expressions: buildData.expressions.map((expression) => ({
      name: expression.fileName.replace(/\.exp\.json$/, ''),
      file: bundleAssetUrl(expression, 'expression'),
    })),
  };

  if (initOpacities?.length) {
    settings.init_opacities = initOpacities.map(({ id, value }) => ({ id, value }));
  }

  return settings;
};

export const createImportCleanedLive2dModelSettings = async (
  modelName: string,
  buildData: BuildData,
  initOpacities?: ModelPartOpacity[],
  selectorPrefix?: string,
  motionAssets?: CompositeSelectorAsset[],
  expressionAssets?: CompositeSelectorAsset[]
) => {
  const settings = createLive2dModelSettings(modelName, buildData, initOpacities) as Record<string, any>;
  const resolvedMotionAssets =
    motionAssets?.length
      ? motionAssets
      : buildData.motions.map((motion) => ({
          selector: selectorName(selectorPrefix, motionKey(motion.fileName) || 'idle'),
          asset: motion,
        }));
  const resolvedExpressionAssets =
    expressionAssets?.length
      ? expressionAssets
      : buildData.expressions.map((expression) => ({
          selector: selectorName(selectorPrefix, expressionKey(expression.fileName)),
          asset: expression,
        }));

  settings.motions = {};
  await Promise.all(
    resolvedMotionAssets.map(async ({ selector, asset }) => {
      const response = await axios.get(bundleAssetUrl(asset, 'motion'), { responseType: 'text' });
      const cleaned = stripImportFromMotionText(response.data as string);
      settings.motions[selector] = [{ file: textDataUrl('application/octet-stream', cleaned) }];
    })
  );

  settings.expressions = await Promise.all(
    resolvedExpressionAssets.map(async ({ selector, asset }) => {
      const response = await axios.get(bundleAssetUrl(asset, 'expression'), { responseType: 'json' });
      const cleaned = stripImportFromExpressionJson(response.data) ?? {};
      return {
        name: selector,
        file: textDataUrl('application/json', JSON.stringify(cleaned)),
      };
    })
  );

  return {
    settings,
    revokeObjectUrls: () => {},
  };
};

export const inspectModelPartIds = async (
  modelName: string,
  buildData: BuildData
): Promise<string[]> => {
  const model = await (Live2DModel as any).from(createLive2dModelSettings(modelName, buildData));
  try {
    const anyModel = model as Record<string, unknown>;
    const internalModel = anyModel.internalModel as Record<string, unknown> | undefined;
    const coreModel = internalModel?.coreModel as Record<string, unknown> | undefined;
    const modelContext =
      typeof coreModel?.getModelContext === 'function'
        ? (coreModel.getModelContext as () => unknown)()
        : undefined;
    return collectStringIds([anyModel, internalModel, coreModel, modelContext], PART_RE);
  } finally {
    try {
      model.destroy();
    } catch {}
  }
};

export const buildInitOpacitiesForCategories = (
  categories: PartCategory[],
  partIds: string[]
): ModelPartOpacity[] | undefined => {
  if (categories.length === 0) return undefined;
  const visible = new Set<string>();
  for (const category of categories) {
    const parts = PART_PRESETS[category] || [];
    parts.forEach((part) => visible.add(part));
  }
  return partIds.map((id) => ({ id, value: visible.has(id) ? 1 : 0 }));
};

export const prepareCompositeLayers = async (
  layers: CompositeLayerDraft[],
  partIdCache: Map<string, string[]>
): Promise<PreparedCompositeLayer[]> => {
  const prepared: PreparedCompositeLayer[] = [];

  for (const [index, layer] of layers.entries()) {
    let initOpacities: ModelPartOpacity[] | undefined;
    const partIds = partIdCache.get(layer.modelName);
    if (layer.partCategories.length > 0 && partIds && partIds.length > 0) {
      initOpacities = buildInitOpacitiesForCategories(layer.partCategories, partIds);
    } else if (layer.partCategories.length > 0) {
      const resolved = await inspectModelPartIds(layer.modelName, layer.buildData);
      partIdCache.set(layer.modelName, resolved);
      if (resolved.length === 0) {
        const categoriesLabel = layer.partCategories.join('/');
        throw new Error(`${layer.modelName} 未能读取到 PARTS_ ID，无法应用「${categoriesLabel}」部件`);
      }
      initOpacities = buildInitOpacitiesForCategories(layer.partCategories, resolved);
    }

    prepared.push({
      ...layer,
      index,
      folderName: `${index + 1} ${layer.partCategories.length > 0 ? layer.partCategories.join('+') : safeSegment(layer.modelName)}`,
      selectorPrefix: getCompositeLayerSelectorPrefix(layer.modelName, layer.characterNames),
      initOpacities,
    });
  }

  return prepared;
};

export const buildCompositeManifest = (layers: PreparedCompositeLayer[], importValue?: number): CompositeManifest => {
  const parts = layers.map((layer) => ({
    path: `${layer.folderName}/model.json`,
    id: layer.selectorPrefix,
    folder: layer.folderName,
    index: layer.index,
  }));

  const summary: CompositeSummary = {
    version: 2,
    motions: getCompositeMotionOptions(layers),
    expressions: getCompositeExpressionOptions(layers),
    import: importValue,
  };

  const rawText = [...parts, summary].map((line) => JSON.stringify(line)).join('\n');
  return { rawText, parts, summary };
};

export const downloadCompositeZip = async (
  layers: CompositeLayerDraft[],
  partIdCache: Map<string, string[]>,
  importValue?: number
) => {
  if (layers.length === 0) return;
  const prepared = await prepareCompositeLayers(layers, partIdCache);
  const motionAssets = getCompositeMotionAssets(prepared);
  const expressionAssets = getCompositeExpressionAssets(prepared);
  const manifest = buildCompositeManifest(prepared, importValue);
  const zip = new JSZip();
  const root = zip.folder('composite-model');
  if (!root) return;

  root.file('composite.jsonl', `${manifest.rawText}\n`);
  await downloadSharedMtnExp(root, motionAssets, expressionAssets, importValue);
  for (const layer of prepared) {
    await addPreparedLayerToZip(root, layer, importValue, motionAssets, expressionAssets);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'composite-model.zip');
};

export const buildWmdlDocument = (layers: PreparedCompositeLayer[], name: string) => {
  if (layers.length === 0) return null;
  return {
    name,
    modelRelativePath: `model/${layers[0].folderName}/model.json`,
    figureTemplate: `changeFigure:%conf_path% -id=${name}_0 -zIndex=0 %me_0%;`,
    transformTemplate: `setTransform:%me_0% -target=${name}_0 -duration=750 -writeDefault;`,
    subModels: layers.slice(1).map((l) => ({
      modelRelativePath: `model/${l.folderName}/model.json`,
      offsetX: 0, offsetY: 0,
    })),
    x: 0, y: 0, scale: 1, rotation: 0, reverseX: false,
    live2dBounds: [0, 0, 0, 0],
  };
};

export const downloadWmdlZip = async (
  layers: CompositeLayerDraft[],
  partIdCache: Map<string, string[]>,
  name: string,
  importValue?: number,
) => {
  if (layers.length === 0) return;
  const prepared = await prepareCompositeLayers(layers, partIdCache);
  const motionAssets = getCompositeMotionAssets(prepared);
  const expressionAssets = getCompositeExpressionAssets(prepared);
  const zip = new JSZip();
  const wmdl = buildWmdlDocument(prepared, name);
  if (wmdl) zip.file(`${name}.wmdl`, JSON.stringify(wmdl, null, '\t'));
  const modelRoot = zip.folder('model');
  if (!modelRoot) return;
  await downloadSharedMtnExp(modelRoot, motionAssets, expressionAssets, importValue);
  for (const layer of prepared) {
    await addPreparedLayerToZip(modelRoot, layer, importValue, motionAssets, expressionAssets);
  }
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `${name}.zip`);
};

const addPreparedLayerToZip = async (
  root: JSZip,
  layer: PreparedCompositeLayer,
  importValue?: number,
  motionAssets: CompositeSelectorAsset[] = [],
  expressionAssets: CompositeSelectorAsset[] = []
) => {
  const layerFolder = root.folder(layer.folderName);
  const charaFolder = layerFolder?.folder('.chara');
  if (!layerFolder || !charaFolder) return;

  const filesToDownload: { url: string; folder: JSZip; name: string }[] = [
    { url: bundleAssetUrl(layer.buildData.model, 'model'), folder: charaFolder, name: 'model.moc' },
    { url: bundleAssetUrl(layer.buildData.physics, 'physics'), folder: charaFolder, name: 'physics.json' },
    ...layer.buildData.textures.map((texture) => ({
      url: bundleAssetUrl(texture, 'texture'),
      folder: charaFolder,
      name: normalizeTextureFileName(texture.fileName),
    })),
  ];

  await Promise.all(
    filesToDownload.map(async (file) => {
      try {
        const response = await axios.get(file.url, { responseType: 'blob' });
        file.folder.file(file.name, response.data);
      } catch (error) {
        console.error(`Failed to download ${file.url}`, error);
      }
    })
  );

  layerFolder.file(
    'model.json',
    JSON.stringify(createDownloadModelJson(layer, importValue, motionAssets, expressionAssets), null, '\t')
  );
};

const createDownloadModelJson = (
  layer: PreparedCompositeLayer,
  importValue?: number,
  motionAssets: CompositeSelectorAsset[] = [],
  expressionAssets: CompositeSelectorAsset[] = []
) => {
  const importDir =
    importValue !== undefined && Number.isFinite(importValue)
      ? `PARAM_IMPORT__${importValue}`
      : '__base__';

  const modelJson: Record<string, unknown> = {
    version: 'Sample 1.0.0',
    layout: { center_x: 0, center_y: 0, width: 2 },
    hit_areas_custom: {
      head_x: [-0.25, 1], head_y: [0.25, 0.2],
      body_x: [-0.3, 0.2], body_y: [0.3, -1.9],
    },
    model: '.chara/model.moc',
    physics: '.chara/physics.json',
    textures: layer.buildData.textures.map((t) => `.chara/${normalizeTextureFileName(t.fileName)}`),
    motions: motionAssets.reduce((acc: Record<string, Array<{ file: string }>>, { selector }) => {
      acc[selector] = [{ file: `../.mtn_exp/motions/${importDir}/${safeSelectorPath(selector)}.mtn` }];
      return acc;
    }, {}),
    expressions: expressionAssets.map(({ selector }) => ({
      name: selector,
      file: `../.mtn_exp/expressions/__base__/${safeSelectorPath(selector)}.exp.json`,
    })),
  };

  if (layer.initOpacities?.length) {
    modelJson.init_opacities = layer.initOpacities.map(({ id, value }) => ({ id, value }));
  }
  if (importValue !== undefined && Number.isFinite(importValue)) {
    modelJson.init_params = [{ id: 'PARAM_IMPORT', value: importValue }];
  }
  return modelJson;
};

export const getCompositeMotionAssets = (layers: Array<Pick<CompositeLayerDraft, 'modelName' | 'buildData' | 'characterNames'>>) =>
  dedupeSelectorAssets(
    layers.flatMap((layer) => {
      if (!layer.buildData?.motions) return [];
      const prefix = getCompositeLayerSelectorPrefix(layer.modelName, layer.characterNames);
      return layer.buildData.motions
        .map((motion) => ({
          selector: selectorName(prefix, motionKey(motion.fileName) || 'idle'),
          asset: motion,
        }));
    })
  );

export const getCompositeExpressionAssets = (layers: Array<Pick<CompositeLayerDraft, 'modelName' | 'buildData' | 'characterNames'>>) =>
  dedupeSelectorAssets(
    layers.flatMap((layer) => {
      const prefix = getCompositeLayerSelectorPrefix(layer.modelName, layer.characterNames);
      return layer.buildData.expressions
        .map((asset) => ({
          selector: selectorName(prefix, expressionKey(asset.fileName)),
          asset,
        }))
        .filter(({ selector }) => selector.split('/').pop());
    })
  );

export const getCompositeMotionOptions = (layers: Array<Pick<CompositeLayerDraft, 'modelName' | 'buildData' | 'characterNames'>>) =>
  getCompositeMotionAssets(layers).map(({ selector }) => selector).sort();

export const getCompositeExpressionOptions = (layers: Array<Pick<CompositeLayerDraft, 'modelName' | 'buildData' | 'characterNames'>>) =>
  getCompositeExpressionAssets(layers).map(({ selector }) => selector).sort();

const dedupeSelectorAssets = (assets: CompositeSelectorAsset[]) => {
  const seen = new Set<string>();
  return assets.filter(({ selector }) => {
    if (seen.has(selector)) return false;
    seen.add(selector);
    return true;
  });
};

const safeSelectorPath = (selector: string) =>
  selector.split('/').map(safeSegment).join('/');

const downloadSharedMtnExp = async (
  root: JSZip,
  motionAssets: CompositeSelectorAsset[],
  expressionAssets: CompositeSelectorAsset[],
  importValue?: number,
) => {
  const mtnExpFolder = root.folder('.mtn_exp');
  if (!mtnExpFolder) return;
  const importDir =
    importValue !== undefined && Number.isFinite(importValue)
      ? `PARAM_IMPORT__${importValue}`
      : '__base__';

  await Promise.all([
    ...motionAssets.map(async ({ selector, asset }) => {
      const parts = safeSelectorPath(selector).split('/');
      const fileName = `${parts.pop()}.mtn`;
      const subfolder = parts.length ? mtnExpFolder.folder('motions')?.folder(importDir)?.folder(parts.join('/')) : mtnExpFolder.folder('motions')?.folder(importDir);
      if (!subfolder) return;
      try {
        const response = await axios.get(bundleAssetUrl(asset, 'motion'), { responseType: 'text' });
        subfolder.file(fileName, stripImportFromMotionText(response.data as string));
      } catch (e) { console.error(`mtn download failed: ${selector}`, e); }
    }),
    ...expressionAssets.map(async ({ selector, asset }) => {
      const parts = safeSelectorPath(selector).split('/');
      const fileName = `${parts.pop()}.exp.json`;
      const subfolder = parts.length ? mtnExpFolder.folder('expressions')?.folder('__base__')?.folder(parts.join('/')) : mtnExpFolder.folder('expressions')?.folder('__base__');
      if (!subfolder) return;
      try {
        const response = await axios.get(bundleAssetUrl(asset, 'expression'), { responseType: 'json' });
        const cleaned = stripImportFromExpressionJson(response.data) ?? {};
        subfolder.file(fileName, JSON.stringify(cleaned));
      } catch (e) { console.error(`exp download failed: ${selector}`, e); }
    }),
  ]);
};

const collectStringIds = (sources: unknown[], pattern: RegExp): string[] => {
  const ids = new Set<string>();
  const visited = new WeakSet<object>();

  for (const source of sources) {
    walkValue(source, visited, (value) => {
      const text = typeof value === 'string' ? value : readIdCandidate(value);
      if (text && pattern.test(text)) ids.add(text);
    });
  }

  return Array.from(ids).sort();
};

const walkValue = (
  value: unknown,
  visited: WeakSet<object>,
  onVisit: (value: unknown) => void,
  depth = 0
) => {
  if (depth > 8) return;
  onVisit(value);
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  for (const entry of Object.values(value)) {
    walkValue(entry, visited, onVisit, depth + 1);
  }
};

const readIdCandidate = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['id', 'ID', '_id', '_$r']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
};
