import { BundleFile } from '../types';
import { getAssetsBase } from '../config';

const stripBytesSuffix = (fileName: string) => fileName.replace(/\.bytes$/, '');
const ensurePngSuffix = (fileName: string) => (fileName.includes('.') ? fileName : `${fileName}.png`);

export const normalizeModelFileName = (fileName: string) => stripBytesSuffix(fileName);
export const normalizeMotionFileName = (fileName: string) => stripBytesSuffix(fileName);
export const normalizeTextureFileName = (fileName: string) => {
  if (fileName.endsWith('.bytes')) return fileName.replace(/\.bytes$/, '.png');
  return ensurePngSuffix(fileName);
};

export const bundleAssetUrl = (
  file: BundleFile,
  kind: 'model' | 'physics' | 'texture' | 'motion' | 'expression'
) => {
  let fileName = file.fileName;
  if (kind === 'model') fileName = normalizeModelFileName(fileName);
  if (kind === 'motion') fileName = normalizeMotionFileName(fileName);
  if (kind === 'texture') fileName = normalizeTextureFileName(fileName);
  return `${getAssetsBase()}/jp/${file.bundleName}_rip/${fileName}`;
};
