import axios from 'axios';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display-webgal/cubism2';
import { PART_PRESETS } from '../data/partPresets';
import {
  BuildData,
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

const motionKey = (fileName: string) => {
  const last = fileName.split('/').pop() || 'idle';
  return last.replace(/\.bytes$/, '').replace(/\.mtn$/, '');
};

const expressionKey = (fileName: string) =>
  (fileName.split('/').pop() || '').replace(/\.exp\.json$/, '');

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
      folderName: `layer_${String(index).padStart(2, '0')}_${safeSegment(layer.modelName)}_${safeSegment(layer.layerId)}`,
      initOpacities,
    });
  }

  return prepared;
};

export const buildCompositeManifest = (layers: PreparedCompositeLayer[], importValue?: number): CompositeManifest => {
  const parts = layers.map((layer) => ({
    path: `${layer.folderName}/model.json`,
    id: `${layer.index}_${safeSegment(layer.partCategories.join('-'))}_${safeSegment(layer.modelName)}_${safeSegment(layer.layerId)}`,
    folder: layer.folderName,
    index: layer.index,
  }));

  const summary: CompositeSummary = {
    version: 2,
    motions: commonMotions(layers),
    expressions: unionExpressions(layers),
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
  const manifest = buildCompositeManifest(prepared, importValue);
  const zip = new JSZip();
  const root = zip.folder('composite-model');
  if (!root) return;

  root.file('composite.jsonl', `${manifest.rawText}\n`);

  for (const layer of prepared) {
    await addPreparedLayerToZip(root, layer);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'composite-model.zip');
};

const addPreparedLayerToZip = async (root: JSZip, layer: PreparedCompositeLayer) => {
  const layerFolder = root.folder(layer.folderName);
  const dataFolder = layerFolder?.folder('data');
  if (!layerFolder || !dataFolder) return;

  const filesToDownload: { url: string; folder: JSZip; name: string }[] = [
    {
      url: bundleAssetUrl(layer.buildData.model, 'model'),
      folder: dataFolder,
      name: 'model.moc',
    },
    {
      url: bundleAssetUrl(layer.buildData.physics, 'physics'),
      folder: dataFolder,
      name: 'physics.json',
    },
  ];

  const textureFolder = dataFolder.folder('textures');
  if (textureFolder) {
    layer.buildData.textures.forEach((texture) => {
      filesToDownload.push({
        url: bundleAssetUrl(texture, 'texture'),
        folder: textureFolder,
        name: normalizeTextureFileName(texture.fileName),
      });
    });
  }

  const motionFolder = dataFolder.folder('motions');
  if (motionFolder) {
    layer.buildData.motions.forEach((motion) => {
      filesToDownload.push({
        url: bundleAssetUrl(motion, 'motion'),
        folder: motionFolder,
        name: normalizeMotionFileName(motion.fileName),
      });
    });
  }

  const expressionFolder = dataFolder.folder('expressions');
  if (expressionFolder) {
    layer.buildData.expressions.forEach((expression) => {
      filesToDownload.push({
        url: bundleAssetUrl(expression, 'expression'),
        folder: expressionFolder,
        name: expression.fileName,
      });
    });
  }

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

  layerFolder.file('model.json', JSON.stringify(createDownloadModelJson(layer), null, 2));
};

const createDownloadModelJson = (layer: PreparedCompositeLayer) => {
  const modelJson: Record<string, unknown> = {
    version: 'Sample 1.0.0',
    layout: { center_x: 0, center_y: 0, width: 2 },
    hit_areas_custom: {
      head_x: [-0.25, 1],
      head_y: [0.25, 0.2],
      body_x: [-0.3, 0.2],
      body_y: [0.3, -1.9],
    },
    model: 'data/model.moc',
    physics: 'data/physics.json',
    textures: layer.buildData.textures.map(
      (texture) => `data/textures/${normalizeTextureFileName(texture.fileName)}`
    ),
    motions: layer.buildData.motions.reduce((acc: Record<string, Array<{ file: string }>>, motion) => {
      const normalizedFile = normalizeMotionFileName(motion.fileName);
      const name = normalizedFile.split('/').pop()?.replace(/\.mtn$/, '') || 'motion';
      acc[name] = [{ file: `data/motions/${normalizedFile}` }];
      return acc;
    }, {}),
    expressions: layer.buildData.expressions.map((expression) => ({
      name: expression.fileName.replace(/\.exp\.json$/, ''),
      file: `data/expressions/${expression.fileName}`,
    })),
  };

  if (layer.initOpacities?.length) {
    modelJson.init_opacities = layer.initOpacities.map(({ id, value }) => ({ id, value }));
  }

  return modelJson;
};

const commonMotions = (layers: PreparedCompositeLayer[]) => {
  let common: Set<string> | null = null;
  for (const layer of layers) {
    const current = new Set<string>(
      layer.buildData.motions.map((motion) => motionKey(motion.fileName)).filter(Boolean)
    );
    common = common
      ? new Set<string>([...common].filter((motion: string) => current.has(motion)))
      : current;
  }
  return Array.from(common || []).sort();
};

const unionExpressions = (layers: PreparedCompositeLayer[]) =>
  Array.from(
    new Set(
      layers.flatMap((layer) =>
        layer.buildData.expressions.map((expression) => expressionKey(expression.fileName)).filter(Boolean)
      )
    )
  ).sort();

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
