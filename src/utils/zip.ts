import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { BuildData } from '../types';
import axios from 'axios';

const removeBytesSuffix = (fileName: string) => fileName.replace(/\.bytes$/, '');
const ensurePngSuffix = (fileName: string) => fileName.includes('.') ? fileName : `${fileName}.png`;

const addModelToZip = async (zip: JSZip, modelName: string, buildData: BuildData) => {
  const rootFolder = zip.folder(modelName);
  if (!rootFolder) return;
  const dataFolder = rootFolder.folder('data');
  if (!dataFolder) return;

  const baseUrl = `/bestdori-assets/jp/live2d/chara/${modelName}_rip/`;
  const filesToDownload: { url: string; folder: JSZip; name: string }[] = [];

  filesToDownload.push({
    url: `${baseUrl}${buildData.model.fileName}`,
    folder: dataFolder,
    name: 'model.moc'
  });

  filesToDownload.push({
    url: `${baseUrl}${buildData.physics.fileName}`,
    folder: dataFolder,
    name: 'physics.json'
  });

  const textureFolder = dataFolder.folder('textures');
  if (textureFolder) {
    buildData.textures.forEach(t => {
      filesToDownload.push({
        url: `${baseUrl}${t.fileName}`,
        folder: textureFolder,
        name: ensurePngSuffix(t.fileName)
      });
    });
  }

  const motionFolder = dataFolder.folder('motions');
  if (motionFolder) {
    buildData.motions.forEach(m => {
      filesToDownload.push({
        url: `${baseUrl}${m.fileName}`,
        folder: motionFolder,
        name: removeBytesSuffix(m.fileName)
      });
    });
  }

  const expressionFolder = dataFolder.folder('expressions');
  if (expressionFolder) {
    buildData.expressions.forEach(e => {
      filesToDownload.push({
        url: `${baseUrl}${e.fileName}`,
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
    textures: buildData.textures.map(t => `data/textures/${ensurePngSuffix(t.fileName)}`),
    motions: buildData.motions.reduce((acc: any, m) => {
      const name = removeBytesSuffix(m.fileName).split('/').pop()?.replace(/\.mtn$/, '') || 'motion';
      acc[name] = [{ file: `data/motions/${removeBytesSuffix(m.fileName)}` }];
      return acc;
    }, {}),
    expressions: buildData.expressions.map(e => ({
      name: e.fileName.replace(/\.exp\.json$/, ''),
      file: `data/expressions/${e.fileName}`
    }))
  };

  rootFolder.file('model.json', JSON.stringify(modelJson, null, 2));
};

export const downloadModelsAsZip = async (
  models: Map<string, BuildData>,
  onProgress?: (current: number, total: number) => void
) => {
  const zip = new JSZip();
  const entries = Array.from(models.entries());
  let done = 0;

  for (const [name, data] of entries) {
    await addModelToZip(zip, name, data);
    done++;
    onProgress?.(done, entries.length);
  }

  const content = await zip.generateAsync({ type: 'blob' });

  const zipName = entries.length === 1 ? `${entries[0][0]}.zip` : `live2d_models_${entries.length}.zip`;
  saveAs(content, zipName);
};
