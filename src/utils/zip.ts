import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { BuildData } from '../types';
import axios from 'axios';

const removeBytesSuffix = (fileName: string) => fileName.replace(/\.bytes$/, '');
const ensurePngSuffix = (fileName: string) => fileName.includes('.') ? fileName : `${fileName}.png`;

export const downloadModelAsZip = async (modelName: string, buildData: BuildData) => {
  const zip = new JSZip();
  const rootFolder = zip.folder(modelName);
  if (!rootFolder) return;
  const dataFolder = rootFolder.folder('data');
  if (!dataFolder) return;

  const baseUrl = `/bestdori-assets/jp/live2d/chara/${modelName}_rip/`;

  const filesToDownload: { url: string; folder: JSZip; name: string }[] = [];

  // Model file
  const modelFileName = removeBytesSuffix(buildData.model.fileName);
  filesToDownload.push({
    url: `${baseUrl}${buildData.model.fileName}`,
    folder: dataFolder,
    name: 'model.moc'
  });

  // Physics file
  filesToDownload.push({
    url: `${baseUrl}${buildData.physics.fileName}`,
    folder: dataFolder,
    name: 'physics.json'
  });

  // Textures
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

  // Motions
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

  // Expressions
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

  // Download all files
  const downloadPromises = filesToDownload.map(async (file) => {
    try {
      const response = await axios.get(file.url, { responseType: 'blob' });
      file.folder.file(file.name, response.data);
    } catch (error) {
      console.error(`Failed to download ${file.url}`, error);
    }
  });

  await Promise.all(downloadPromises);

  // Construct model.json
  const modelJson = {
    version: "Sample 1.0.0",
    layout: { center_x: 0, center_y: 0, width: 2 },
    hit_areas_custom: {
      head_x: [-0.25, 1],
      head_y: [0.25, 0.2],
      body_x: [-0.3, 0.2],
      body_y: [0.3, -1.9]
    },
    model: "data/model.moc",
    physics: "data/physics.json",
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

  // Generate and save ZIP
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `${modelName}.zip`);
};
