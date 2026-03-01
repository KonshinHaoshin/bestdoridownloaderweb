import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { BuildData } from '../types';
import axios from 'axios';
import { bundleAssetUrl, normalizeMotionFileName, normalizeTextureFileName } from './assets';

const addModelToZip = async (zip: JSZip, modelName: string, buildData: BuildData) => {
  const rootFolder = zip.folder(modelName);
  if (!rootFolder) return;
  const dataFolder = rootFolder.folder('data');
  if (!dataFolder) return;

  const filesToDownload: { url: string; folder: JSZip; name: string }[] = [];

  filesToDownload.push({
    url: bundleAssetUrl(buildData.model, 'model'),
    folder: dataFolder,
    name: 'model.moc'
  });

  filesToDownload.push({
    url: bundleAssetUrl(buildData.physics, 'physics'),
    folder: dataFolder,
    name: 'physics.json'
  });

  const textureFolder = dataFolder.folder('textures');
  if (textureFolder) {
    buildData.textures.forEach(t => {
      filesToDownload.push({
        url: bundleAssetUrl(t, 'texture'),
        folder: textureFolder,
        name: normalizeTextureFileName(t.fileName)
      });
    });
  }

  const motionFolder = dataFolder.folder('motions');
  if (motionFolder) {
    buildData.motions.forEach(m => {
      filesToDownload.push({
        url: bundleAssetUrl(m, 'motion'),
        folder: motionFolder,
        name: normalizeMotionFileName(m.fileName)
      });
    });
  }

  const expressionFolder = dataFolder.folder('expressions');
  if (expressionFolder) {
    buildData.expressions.forEach(e => {
      filesToDownload.push({
        url: bundleAssetUrl(e, 'expression'),
        folder: expressionFolder,
        name: e.fileName
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

  const modelJson = {
    version: 'Sample 1.0.0',
    layout: { center_x: 0, center_y: 0, width: 2 },
    hit_areas_custom: {
      head_x: [-0.25, 1],
      head_y: [0.25, 0.2],
      body_x: [-0.3, 0.2],
      body_y: [0.3, -1.9]
    },
    model: 'data/model.moc',
    physics: 'data/physics.json',
    textures: buildData.textures.map(t => `data/textures/${normalizeTextureFileName(t.fileName)}`),
    motions: buildData.motions.reduce((acc: any, m) => {
      const normalizedFile = normalizeMotionFileName(m.fileName);
      const name = normalizedFile.split('/').pop()?.replace(/\.mtn$/, '') || 'motion';
      acc[name] = [{ file: `data/motions/${normalizedFile}` }];
      return acc;
    }, {}),
    expressions: buildData.expressions.map(e => ({
      name: e.fileName.replace(/\.exp\.json$/, ''),
      file: `data/expressions/${e.fileName}`
    }))
  };

  rootFolder.file('model.json', JSON.stringify(modelJson, null, 2));
};

/** 将选中的多个模型分别打成多个 ZIP，逐个下载（与单选行为一致） */
export const downloadModelsAsZip = async (
  models: Map<string, BuildData>,
  onProgress?: (current: number, total: number) => void
) => {
  const entries = Array.from(models.entries());
  let done = 0;

  for (const [name, data] of entries) {
    const zip = new JSZip();
    await addModelToZip(zip, name, data);
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${name}.zip`);
    done++;
    onProgress?.(done, entries.length);
  }
};
