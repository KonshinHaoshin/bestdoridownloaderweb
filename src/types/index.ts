export interface BundleFile {
  bundleName: string;
  fileName: string;
}

export interface BuildData {
  model: BundleFile;
  physics: BundleFile;
  textures: BundleFile[];
  transition: BundleFile;
  motions: BundleFile[];
  expressions: BundleFile[];
}

export interface MotionFile {
  file: string;
}

export interface ExpressionFile {
  name: string;
  file: string;
}

export interface Live2dModel {
  model: string;
  physics: string;
  textures: string[];
  motions: Record<string, MotionFile[]>;
  expressions: ExpressionFile[];
}

export interface CharacterInfo {
  characterType: string;
  characterName: string[];
  nickname: (string | null)[];
}

export type CharaRoster = Record<string, CharacterInfo>;

export interface CostumeInfo {
  characterId: number;
  assetBundleName: string;
  description?: string[];
  publishedAt?: (string | null)[];
}

export type CostumeMap = Record<string, CostumeInfo>;

export interface CardInfo {
  characterId: number;
  rarity: number;
  resourceSetName: string;
  prefix?: (string | null)[];
  releasedAt?: (string | null)[];
  type?: string;
  stat?: {
    training?: unknown;
  };
}

export type CardMap = Record<string, CardInfo>;

export type PartCategory = '后发' | '身体' | '脸' | '帽子';

export interface ModelPartOpacity {
  id: string;
  value: number;
}

export interface CompositeLayerDraft {
  layerId: string;
  modelName: string;
  buildData: BuildData;
  partCategories: PartCategory[];
}

export interface PreparedCompositeLayer extends CompositeLayerDraft {
  folderName: string;
  index: number;
  initOpacities?: ModelPartOpacity[];
}

export interface CompositePart {
  path: string;
  type?: 'live2d';
  id?: string;
  folder?: string;
  index?: number;
}

export interface CompositeSummary {
  version?: number;
  motions?: string[];
  expressions?: string[];
  import?: number;
}

export interface CompositeManifest {
  rawText: string;
  parts: CompositePart[];
  summary: CompositeSummary;
}
