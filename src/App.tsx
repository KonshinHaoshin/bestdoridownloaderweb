import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchCharaRoster, fetchAssetsIndex, fetchBuildData, fetchModelSize, formatSize, getFileCount, fetchCostumes, fetchCards } from './api/bestdori';
import { CharaRoster, BuildData, CardInfo, CardMap, CostumeInfo, CostumeMap, CompositeLayerDraft, PartCategory } from './types';
import Live2dPreview, { Live2dPreviewHandle } from './components/Live2dPreview';
import CompositeLive2dPreview from './components/CompositeLive2dPreview';
import { getAssetsBase } from './config';
import { downloadModelsAsZip } from './utils/zip';
import { downloadCompositeZip } from './utils/composite';
import { searchLive2dModels } from './utils/search';
import { CUSTOM_CHARA_ROSTER } from './data/customCharacters';
import { PART_CATEGORIES, PART_PRESET_MAP, PART_PRESET_OPTIONS, type PartPresetName } from './data/partPresets';
import { Search, Download, Eye, Loader2, Sparkles, User, Package, CheckCircle2, X, HardDrive, FileBox, Copy, Layers3, Boxes, ArrowUp, ArrowDown, CopyPlus } from 'lucide-react';

type AppMode = 'download' | 'composite';

const safeDownloadFileName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, '_');

const downloadUrlAsFile = async (url: string, fileName: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error(`资源不是图片：${contentType || 'unknown'}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = safeDownloadFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
};

const tryDownloadUrlAsFile = async (url: string, fileName: string) => {
  try {
    await downloadUrlAsFile(url, fileName);
    return true;
  } catch (e) {
    console.warn('Image download skipped:', url, e);
    return false;
  }
};

type CardDownloadInfo = {
  resourceSetName: string;
  label: string;
  normalUrl: string;
  trainedUrl?: string;
};

type CostumeAssetInfo = {
  description: string[];
  thumbUrl: string;
  cards: CardDownloadInfo[];
};

type CompositeLayerRow = {
  layerId: string;
  modelName: string;
  presetName: PartPresetName;
  partCategories: PartCategory[];
};

const compactStrings = (values?: Array<string | null>) => (values || []).filter(Boolean) as string[];
const normalizeApiText = (value: string) => value.normalize('NFKC').trim().toLowerCase();

const hasSharedText = (left?: Array<string | null>, right?: Array<string | null>) => {
  const rightSet = new Set(compactStrings(right).map(normalizeApiText));
  return compactStrings(left).some((value) => rightSet.has(normalizeApiText(value)));
};

const hasSharedDate = (left?: Array<string | null>, right?: Array<string | null>) => {
  const rightSet = new Set(compactStrings(right));
  return compactStrings(left).some((value) => rightSet.has(value));
};

const cardMatchesCostume = (card: CardInfo, costume: CostumeInfo) =>
  card.characterId === costume.characterId &&
  (hasSharedText(card.prefix, costume.description) || hasSharedDate(card.releasedAt, costume.publishedAt));

const cardLabel = (card: CardInfo) => compactStrings(card.prefix)[3] || compactStrings(card.prefix)[1] || compactStrings(card.prefix)[0] || card.resourceSetName;

function App() {
  const [roster, setRoster] = useState<CharaRoster | null>(null);
  const [assetsIndex, setAssetsIndex] = useState<any>(null);
  const [costumeMap, setCostumeMap] = useState<CostumeMap | null>(null);
  const [cardMap, setCardMap] = useState<CardMap | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [costumes, setCostumes] = useState<string[]>([]);
  const [matchedCharaName, setMatchedCharaName] = useState('');

  // Mode: 独立下载 vs 拼好模工作区（共享同一份 selectedMap / compositeLayerRows）
  const [mode, setMode] = useState<AppMode>('download');

  // Preview (single)
  const [previewCostume, setPreviewCostume] = useState<string | null>(null);
  const [previewBuildData, setPreviewBuildData] = useState<BuildData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [selectedMotion, setSelectedMotion] = useState('idle');
  const [selectedExpression, setSelectedExpression] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [nameImportList, setNameImportList] = useState<Array<{import: number; name_ja: string; name_en: string; name_zh: string}>>([]);
  const [showImportTable, setShowImportTable] = useState(false);
  const [importSearch, setImportSearch] = useState('');
  const previewRef = useRef<Live2dPreviewHandle | null>(null);

  // Selection (shared by both modes — each selected model becomes a layer row)
  const [selectedMap, setSelectedMap] = useState<Map<string, BuildData>>(new Map());
  const [modelSizes, setModelSizes] = useState<Map<string, number>>(new Map());

  // Per-model ZIP download
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  // Composite (拼好模)
  const [compositeLayerRows, setCompositeLayerRows] = useState<CompositeLayerRow[]>([]);
  const [isCompositePreview, setIsCompositePreview] = useState(false);
  const [isDownloadingComposite, setIsDownloadingComposite] = useState(false);
  const [compositeStatus, setCompositeStatus] = useState('');

  const initDone = useRef(false);
  const buildDataCache = useRef<Map<string, BuildData>>(new Map());
  const compositePartIdCache = useRef<Map<string, string[]>>(new Map());
  const compositeLayerSeq = useRef(0);
  const nameImportMap = useRef<Map<string, number>>(new Map());
  const createCompositeLayerRow = useCallback(
    (modelName: string, presetName: PartPresetName = '全部'): CompositeLayerRow => ({
      layerId: `${safeDownloadFileName(modelName)}_${Date.now().toString(36)}_${compositeLayerSeq.current++}`,
      modelName,
      presetName,
      partCategories: PART_PRESET_MAP[presetName],
    }),
    []
  );
  const costumeByAsset = useMemo(() => {
    const m = new Map<string, CostumeAssetInfo>();
    if (!costumeMap) return m;
    const assetsBase = getAssetsBase();
    const cardEntries = Object.values(cardMap || {});
    Object.entries(costumeMap).forEach(([id, c]) => {
      if (!c?.assetBundleName) return;
      const costumeId = Number(id);
      const group = Number.isFinite(costumeId) ? Math.floor(costumeId / 50) : 0;
      const thumbUrl = `${assetsBase}/jp/thumb/costume/group${group}_rip/${c.assetBundleName}.png`;
      const cards = cardEntries
        .filter((card) => cardMatchesCostume(card, c))
        .map((card) => {
          const base = `${assetsBase}/jp/characters/resourceset/${card.resourceSetName}_rip`;
          return {
            resourceSetName: card.resourceSetName,
            label: cardLabel(card),
            normalUrl: `${base}/card_normal.png`,
            trainedUrl: card.stat?.training ? `${base}/card_after_training.png` : undefined,
          };
        });
      m.set(c.assetBundleName, { description: c.description || [], thumbUrl, cards });
    });
    return m;
  }, [costumeMap, cardMap]);

  const getCachedBuildData = async (name: string): Promise<BuildData> => {
    const cached = buildDataCache.current.get(name);
    if (cached) return cached;
    const data = await fetchBuildData(name);
    buildDataCache.current.set(name, data);
    return data;
  };

  const motionOptions = useMemo(() => {
    if (!previewBuildData) return [];
    return Array.from(
      new Set(
        previewBuildData.motions.map((m) =>
          (m.fileName.split('/').pop() || 'idle').replace(/\.bytes$/, '').replace(/\.mtn$/, '')
        )
      )
    ).sort();
  }, [previewBuildData]);

  const expressionOptions = useMemo(() => {
    if (!previewBuildData) return [];
    return Array.from(
      new Set(
        previewBuildData.expressions
          .map((e) => (e.fileName.split('/').pop() || '').replace(/\.exp\.json$/, ''))
          .filter(Boolean)
      )
    ).sort();
  }, [previewBuildData]);

  const compositeLayers = useMemo<CompositeLayerDraft[]>(() =>
    compositeLayerRows
      .filter((row) => selectedMap.has(row.modelName))
      .map((row) => ({
        layerId: row.layerId,
        modelName: row.modelName,
        buildData: selectedMap.get(row.modelName)!,
        partCategories: row.partCategories,
      })),
    [compositeLayerRows, selectedMap]
  );

  const matchedImportValue = useMemo(() => {
    if (!matchedCharaName) return undefined;
    return nameImportMap.current.get(matchedCharaName.replace(/\s/g, '').toLowerCase());
  }, [matchedCharaName]);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    (async () => {
      try {
        const [r, a, c, cards, nameImport] = await Promise.all([
          fetchCharaRoster(), fetchAssetsIndex(), fetchCostumes(), fetchCards(),
          fetch('/name_import.json').then((res) => res.json()),
        ]);
        setRoster({ ...r, ...CUSTOM_CHARA_ROSTER });
        setAssetsIndex(a);
        setCostumeMap(c);
        setCardMap(cards);
        setNameImportList(nameImport);
        const nim = new Map<string, number>();
        (nameImport as Array<{import: number; name_ja: string; name_en: string; name_zh: string}>).forEach((e) => {
          [e.name_ja, e.name_en, e.name_zh].forEach((n) => nim.set(n.replace(/\s/g, '').toLowerCase(), e.import));
        });
        nameImportMap.current = nim;
      } catch (e) {
        console.error('Init failed:', e);
      }
    })();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roster) return;

    const rawTerm = searchTerm.trim();
    if (!rawTerm) return;

    const assets = assetsIndex?.live2d?.chara || {};
    const result = searchLive2dModels({
      roster,
      assets,
      costumeByAsset,
      query: rawTerm,
    });

    if (!result) {
      setMatchedCharaName('');
      setCostumes([]);
      setPreviewCostume(null);
      setPreviewBuildData(null);
      return;
    }

    setMatchedCharaName(result.label);
    setCostumes(result.models);
    setPreviewCostume(null);
    setPreviewBuildData(null);

    // Pre-fetch all buildData in background so buttons respond instantly
    result.models.forEach((name) => {
      if (!buildDataCache.current.has(name)) {
        fetchBuildData(name)
          .then((data) => buildDataCache.current.set(name, data))
          .catch(() => {});
      }
    });
  };

  // Toggle preview
  const handlePreview = useCallback(async (name: string) => {
    if (previewCostume === name) {
      setPreviewCostume(null);
      setPreviewBuildData(null);
      setSelectedMotion('idle');
      setSelectedExpression('');
      setCopyStatus('');
      return;
    }
    setIsCompositePreview(false);
    setIsPreviewLoading(true);
    try {
      const data = await getCachedBuildData(name);
      const nextMotion =
        data.motions
          .map((m) => (m.fileName.split('/').pop() || 'idle').replace(/\.bytes$/, '').replace(/\.mtn$/, ''))
          .find((m) => m === 'idle') || 'idle';
      setSelectedMotion(nextMotion);
      setSelectedExpression('');
      setCopyStatus('');
      setPreviewBuildData(data);
      setPreviewCostume(name);
    } catch (e) {
      console.error('Preview failed:', e);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [previewCostume]);

  const handleCopyPreview = useCallback(async () => {
    if (!previewRef.current) return;
    try {
      await previewRef.current.copyImage();
      setCopyStatus('图片已复制');
      window.setTimeout(() => setCopyStatus(''), 1800);
    } catch (e) {
      setCopyStatus(e instanceof Error ? e.message : '复制失败');
      window.setTimeout(() => setCopyStatus(''), 2200);
    }
  }, []);

  const handleDownloadPreviewImage = useCallback(async () => {
    if (!previewRef.current || !previewCostume) return;
    try {
      await previewRef.current.downloadImage(`${previewCostume}.png`);
      setCopyStatus('截图已下载');
      window.setTimeout(() => setCopyStatus(''), 1800);
    } catch (e) {
      setCopyStatus(e instanceof Error ? e.message : '下载失败');
      window.setTimeout(() => setCopyStatus(''), 2200);
    }
  }, [previewCostume]);

  const handleDownloadCostumeThumb = useCallback(async (name: string) => {
    const thumbUrl = costumeByAsset.get(name)?.thumbUrl;
    if (!thumbUrl) return;
    try {
      await downloadUrlAsFile(thumbUrl, `${name}.png`);
    } catch (e) {
      console.error('Costume thumbnail download failed:', e);
    }
  }, [costumeByAsset]);

  const handleDownloadCardImages = useCallback(async (name: string) => {
    const cards = costumeByAsset.get(name)?.cards || [];
    try {
      for (const card of cards) {
        const downloadedNormal = await tryDownloadUrlAsFile(card.normalUrl, `${card.resourceSetName}_card_normal.png`);
        let downloadedTrained = false;
        if (card.trainedUrl) {
          downloadedTrained = await tryDownloadUrlAsFile(card.trainedUrl, `${card.resourceSetName}_card_after_training.png`);
        }
        if (!downloadedNormal && !downloadedTrained) throw new Error(`没有可下载卡面：${card.resourceSetName}`);
      }
    } catch (e) {
      console.error('Card image download failed:', e);
    }
  }, [costumeByAsset]);

  // Toggle select (shared by both modes). Selecting adds a composite layer row;
  // deselecting removes all layer rows that referenced the model.
  const handleSelect = useCallback(async (name: string) => {
    if (selectedMap.has(name)) {
      setSelectedMap((prev) => {
        const next = new Map(prev);
        next.delete(name);
        return next;
      });
      setModelSizes((prev) => {
        const next = new Map(prev);
        next.delete(name);
        return next;
      });
      setCompositeLayerRows((prev) => prev.filter((row) => row.modelName !== name));
      return;
    }
    try {
      const data = await getCachedBuildData(name);
      setSelectedMap((prev) => new Map(prev).set(name, data));
      setCompositeLayerRows((prev) => [...prev, createCompositeLayerRow(name)]);
      if (!modelSizes.has(name)) {
        fetchModelSize(data).then((size) => {
          setModelSizes((prev) => new Map(prev).set(name, size));
        });
      }
    } catch (e) {
      console.error('Select failed:', e);
    }
  }, [selectedMap, modelSizes, createCompositeLayerRow]);

  const handleRemoveSelected = (name: string) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    setModelSizes((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    setCompositeLayerRows((prev) => prev.filter((row) => row.modelName !== name));
  };

  const handleClearAll = () => {
    setSelectedMap(new Map());
    setModelSizes(new Map());
    setCompositeLayerRows([]);
    setIsCompositePreview(false);
    setCompositeStatus('');
  };

  const handleDownloadZip = async () => {
    if (selectedMap.size === 0 || isDownloadingZip) return;
    setIsDownloadingZip(true);
    setDownloadProgress('准备中…');
    try {
      await downloadModelsAsZip(selectedMap, (cur, total) => {
        setDownloadProgress(`${cur} / ${total} 个已下载`);
      });
    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setIsDownloadingZip(false);
      setDownloadProgress('');
    }
  };

  const handleCompositePresetChange = (layerId: string, presetName: PartPresetName) => {
    setCompositeLayerRows((prev) =>
      prev.map((row) => row.layerId === layerId ? { ...row, presetName, partCategories: PART_PRESET_MAP[presetName] } : row)
    );
    setCompositeStatus('');
  };

  const moveCompositeLayer = (layerId: string, direction: -1 | 1) => {
    setCompositeLayerRows((prev) => {
      const index = prev.findIndex((row) => row.layerId === layerId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setCompositeStatus('');
  };

  const duplicateCompositeLayer = (layerId: string) => {
    setCompositeLayerRows((prev) => {
      const index = prev.findIndex((row) => row.layerId === layerId);
      if (index < 0) return prev;
      const source = prev[index];
      const next = [...prev];
      next.splice(index + 1, 0, createCompositeLayerRow(source.modelName, source.presetName));
      return next;
    });
    setCompositeStatus('');
  };

  const removeCompositeLayer = (layerId: string) => {
    const target = compositeLayerRows.find((row) => row.layerId === layerId);
    if (!target) return;
    const remainingRows = compositeLayerRows.filter((row) => row.layerId !== layerId);
    setCompositeLayerRows(remainingRows);
    if (!remainingRows.some((row) => row.modelName === target.modelName)) {
      handleRemoveSelected(target.modelName);
    }
    setCompositeStatus('');
  };

  const handlePreviewComposite = () => {
    if (compositeLayers.length === 0) return;
    setPreviewCostume(null);
    setPreviewBuildData(null);
    setSelectedMotion('idle');
    setSelectedExpression('');
    setCopyStatus('');
    setIsCompositePreview(true);
    setCompositeStatus(`正在预览 ${compositeLayers.length} 层拼好模`);
  };

  const handleDownloadComposite = async () => {
    if (compositeLayers.length === 0 || isDownloadingComposite) return;
    setIsDownloadingComposite(true);
    setCompositeStatus('正在生成拼好模 ZIP…');
    try {
      await downloadCompositeZip(compositeLayers, compositePartIdCache.current, matchedImportValue);
      setCompositeStatus('拼好模 ZIP 已生成');
    } catch (e) {
      console.error('Composite download failed:', e);
      setCompositeStatus(e instanceof Error ? e.message : '拼好模 ZIP 生成失败');
    } finally {
      setIsDownloadingComposite(false);
    }
  };

  const switchMode = (next: AppMode) => {
    if (next === mode) return;
    setMode(next);
    // 离开拼好模工作区时不再占用预览窗
    if (next !== 'composite') setIsCompositePreview(false);
  };

  const totalSize = Array.from(modelSizes.values()).reduce((s, v) => s + v, 0);
  const selectedCount = selectedMap.size;
  const compositeLayerCount = compositeLayers.length;
  const anyDownloading = isDownloadingZip || isDownloadingComposite;

  // 在拼好模工作区，未触发预览且无单模型预览时，提示用户点预览
  const showCompositeHint =
    mode === 'composite' &&
    !isCompositePreview &&
    !previewCostume &&
    compositeLayerCount > 0;

  return (
    <div className="min-h-screen text-zinc-900 font-mono">
      {/* Header */}
      <header className="pt-12 pb-8 text-center select-none border-b-2 border-yellow-300">
        <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase text-zinc-900">
          LIVE2D EXPLORER
        </h1>
        <p className="text-zinc-500 text-xs tracking-widest uppercase mt-3 mb-6">
          搜索、预览、打包下载 BanG Dream! Live2D 模型
        </p>

        {/* Mode segmented control */}
        <div className="inline-flex border-2 border-zinc-300 bg-zinc-100 p-1 gap-1">
          <button
            type="button"
            onClick={() => switchMode('download')}
            className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-bold transition-all ${
              mode === 'download'
                ? 'bg-yellow-300 text-black'
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
            title="每个模型单独打包为 ZIP"
          >
            <FileBox className="w-4 h-4" />
            独立下载
          </button>
          <button
            type="button"
            onClick={() => switchMode('composite')}
            className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-bold transition-all ${
              mode === 'composite'
                ? 'bg-white text-black'
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
            title="把选中的模型当作图层拼成一个 composite.jsonl 包"
          >
            <Boxes className="w-4 h-4" />
            拼好模工作区
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="max-w-2xl mx-auto px-4 mb-10 mt-8">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-grow">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
            <input
              type="text"
              placeholder="输入角色或服装名 (如: 爱音, ひみつの作戦会議)"
              className="w-full pl-12 pr-4 py-4 bg-white border-2 border-zinc-300 focus:border-yellow-300 outline-none text-base placeholder:text-zinc-700 transition-colors"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="px-8 py-4 bg-yellow-300 text-black font-black text-base hover:bg-zinc-100 active:scale-95 transition-all"
          >
            搜索
          </button>
          <button
            type="button"
            onClick={() => { setShowImportTable(true); setImportSearch(''); }}
            className="px-5 py-4 border-2 border-zinc-300 bg-white font-bold text-sm text-zinc-500 hover:text-amber-600 hover:border-yellow-300 transition-all whitespace-nowrap"
          >
            角色ID表
          </button>
        </form>
      </div>

      {/* Main */}
      <div className="max-w-7xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* ===== LEFT: Model Library + (mode-specific panel) ===== */}
          <section className="lg:col-span-5 flex flex-col gap-8">

            {/* Model Library — shared in both modes */}
            <div className="rounded overflow-hidden border border-zinc-200 bg-white flex flex-col" style={{ height: '480px' }}>
            <div className="px-6 py-5 border-b border-zinc-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded bg-amber-50">
                  <User className="w-5 h-5 text-amber-600" />
                </div>
                <h2 className="text-lg font-bold">
                  模型库
                  {matchedCharaName && (
                    <span className="ml-2 text-sm font-normal text-slate-500">— {matchedCharaName}</span>
                  )}
                </h2>
              </div>
              <span className="text-[11px] font-mono text-zinc-600 bg-zinc-100 px-3 py-1 border border-zinc-200">
                {costumes.length} models
              </span>
            </div>

            <div className="flex-grow overflow-y-auto px-3 py-3 space-y-2">
              {costumes.map((costume) => {
                const isPreviewing = previewCostume === costume;
                const isSelected = selectedMap.has(costume);
                const size = modelSizes.get(costume);
                const cardCount = costumeByAsset.get(costume)?.cards.length || 0;
                const selectLabel = mode === 'composite' ? (isSelected ? '已加' : '加层') : (isSelected ? '已选' : '选择');

                return (
                  <div
                    key={costume}
                    className={`group flex items-center justify-between gap-2 p-3 rounded transition-all duration-200 border-l-4 ${
                      isSelected ? 'bg-zinc-100 border-yellow-300' : 'border-transparent hover:bg-zinc-100'
                    }`}
                  >
                    {/* Left: indicator + name + size */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2.5 h-2.5 shrink-0 transition-colors ${isPreviewing ? 'bg-yellow-300 shadow-[0_0_6px_rgba(217,119,6,0.5)]' : 'bg-zinc-700'}`} />
                      <div className="min-w-0">
                        <span className="font-semibold truncate block">{costume}</span>
                        {!isSelected && (costumeByAsset.get(costume)?.description?.[3] || costumeByAsset.get(costume)?.description?.[0]) && (
                          <span className="text-[10px] text-slate-500 truncate block">
                            {costumeByAsset.get(costume)?.description?.[3] || costumeByAsset.get(costume)?.description?.[0]}
                          </span>
                        )}
                        {isSelected && size !== undefined && (
                          <span className="text-[10px] text-slate-500 font-mono">{formatSize(size)}</span>
                        )}
                      </div>
                    </div>

                    {/* Right: buttons */}
                    <div className="flex gap-1.5 shrink-0">
                      {costumeByAsset.get(costume)?.thumbUrl && (
                        <div className="relative h-11 w-11 shrink-0">
                          <img
                            src={costumeByAsset.get(costume)!.thumbUrl}
                            alt={costume}
                            className="h-11 w-11 rounded border border-zinc-300 bg-white object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleDownloadCostumeThumb(costume)}
                            title="下载小图标"
                            className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center border border-zinc-300 bg-zinc-100 text-zinc-500 transition-colors hover:border-yellow-300 hover:text-amber-600"
                          >
                            <Download className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      {cardCount > 0 && (
                        <button
                          type="button"
                          onClick={() => handleDownloadCardImages(costume)}
                          title={`下载卡面（${cardCount} 张）`}
                          className="px-3 py-2 rounded text-xs font-bold flex items-center gap-1.5 transition-all bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-amber-600"
                        >
                          <Download className="w-4 h-4" />
                          卡面
                        </button>
                      )}
                      <button
                        onClick={() => handlePreview(costume)}
                        title={isPreviewing ? '关闭预览' : '预览'}
                        className={`px-3 py-2 rounded text-xs font-bold flex items-center gap-1.5 transition-all ${
                          isPreviewing
                            ? 'bg-yellow-300 text-black'
                            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'
                        }`}
                      >
                        <Eye className="w-4 h-4" />
                        {isPreviewing ? '关闭' : '预览'}
                      </button>
                      <button
                        onClick={() => handleSelect(costume)}
                        title={isSelected ? (mode === 'composite' ? '从工作区移除该图层' : '取消选择') : (mode === 'composite' ? '加入拼好模图层' : '加入下载队列')}
                        className={`px-3 py-2 rounded text-xs font-bold flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'bg-yellow-300 text-black'
                            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'
                        }`}
                      >
                        {isSelected ? (mode === 'composite' ? <Layers3 className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />) : (mode === 'composite' ? <CopyPlus className="w-4 h-4" /> : <Download className="w-4 h-4" />)}
                        {selectLabel}
                      </button>
                    </div>
                  </div>
                );
              })}

              {costumes.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center opacity-40 py-24 space-y-4">
                  <Package className="w-14 h-14 text-slate-600" />
                  <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">搜索角色以浏览模型</p>
                </div>
              )}
            </div>
          </div>

          {/* Mode-specific panel */}
          {mode === 'download' ? (
            <div className="rounded overflow-hidden border-2 border-zinc-300 bg-zinc-50 p-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-yellow-300 text-black">
                    <Download className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">下载队列</h3>
                    <p className="text-slate-500 text-sm">每个模型将单独下载为一个 ZIP</p>
                  </div>
                </div>
                {selectedCount > 0 && (
                  <button onClick={handleClearAll} className="text-xs text-slate-500 hover:text-red-400 transition-colors font-bold px-3 py-1.5 rounded hover:bg-red-500/10">
                    全部清空
                  </button>
                )}
              </div>

              {selectedCount > 0 ? (
                <div className="space-y-4">
                  {/* Selected items list */}
                  <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                    {Array.from(selectedMap.entries()).map(([name, data]) => {
                      const size = modelSizes.get(name);
                      const fileCount = getFileCount(data);
                      return (
                        <div key={name} className="flex items-center gap-3 p-3 rounded bg-zinc-100 border border-zinc-200 group">
                          <FileBox className="w-5 h-5 text-amber-600 shrink-0" />
                          <div className="flex-grow min-w-0">
                            <p className="font-bold text-sm truncate">{name}</p>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono mt-0.5">
                              <span>{fileCount} 文件</span>
                              <span>{size !== undefined ? formatSize(size) : '计算中…'}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveSelected(name)}
                            className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary bar */}
                  <div className="flex items-center justify-between px-4 py-3 rounded bg-white border border-zinc-200">
                    <div className="flex items-center gap-2 text-sm">
                      <HardDrive className="w-4 h-4 text-amber-600" />
                      <span className="text-slate-400">共 <strong className="text-zinc-900">{selectedCount}</strong> 个模型</span>
                    </div>
                    <span className="text-sm font-mono font-bold text-amber-600">
                      {totalSize > 0 ? formatSize(totalSize) : '计算大小中…'}
                    </span>
                  </div>

                  {/* Download button */}
                  <button
                    onClick={handleDownloadZip}
                    disabled={isDownloadingZip}
                    className="w-full py-4 bg-yellow-300 text-black font-black text-lg flex items-center justify-center gap-3 hover:bg-zinc-100 disabled:opacity-50 active:scale-[0.98] transition-all"
                  >
                    {isDownloadingZip ? <Loader2 className="w-6 h-6 animate-spin" /> : <Download className="w-6 h-6" />}
                    {isDownloadingZip ? downloadProgress || '下载中…' : `下载 ${selectedCount} 个模型（各为独立 ZIP）`}
                  </button>
                </div>
              ) : (
                <div className="py-14 text-center rounded border-2 border-dashed border-zinc-200">
                  <div className="w-12 h-12 rounded bg-white flex items-center justify-center mx-auto mb-3">
                    <FileBox className="w-6 h-6 text-slate-700" />
                  </div>
                  <h4 className="font-bold text-slate-500 mb-1">未选择模型</h4>
                  <p className="text-slate-600 text-xs">在模型库中点击「选择」以添加到下载队列</p>
                </div>
              )}
            </div>
          ) : (
            /* Composite (拼好模) workspace panel */
            <div className="rounded overflow-hidden border-2 border-zinc-300 bg-zinc-50 p-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white text-black">
                    <Boxes className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">拼好模图层</h3>
                    <p className="text-slate-500 text-sm">按顺序叠加图层，每层可设预设透明度</p>
                  </div>
                </div>
                {compositeLayerCount > 0 && (
                  <button onClick={handleClearAll} className="text-xs text-slate-500 hover:text-red-400 transition-colors font-bold px-3 py-1.5 rounded hover:bg-red-500/10">
                    全部清空
                  </button>
                )}
              </div>

              {compositeLayerCount > 0 ? (
                <div className="space-y-5">
                  {/* Layer stack */}
                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {compositeLayerRows.map((row, layerIndex) => {
                      const { layerId, modelName: name, presetName } = row;
                      const data = selectedMap.get(name);
                      if (!data) return null;
                      const size = modelSizes.get(name);
                      const fileCount = getFileCount(data);
                      return (
                        <div key={layerId} className="rounded bg-zinc-100 border border-zinc-200 p-3 group">
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-center justify-center">
                              <span className="text-[10px] font-mono text-amber-600 font-bold">L{layerIndex + 1}</span>
                              <span className="text-[9px] font-mono text-slate-600">/{compositeLayerCount}</span>
                            </div>
                            <FileBox className="w-5 h-5 text-amber-600 shrink-0" />
                            <div className="flex-grow min-w-0">
                              <p className="font-bold text-sm truncate">{name}</p>
                              <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono mt-0.5">
                                <span>{fileCount} 文件</span>
                                <span>{size !== undefined ? formatSize(size) : '计算中…'}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => moveCompositeLayer(layerId, -1)}
                                disabled={layerIndex <= 0}
                                title="上移图层"
                                className="p-1.5 rounded text-slate-500 hover:text-zinc-900 hover:bg-zinc-200 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500"
                              >
                                <ArrowUp className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => moveCompositeLayer(layerId, 1)}
                                disabled={layerIndex < 0 || layerIndex >= compositeLayerCount - 1}
                                title="下移图层"
                                className="p-1.5 rounded text-slate-500 hover:text-zinc-900 hover:bg-zinc-200 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500"
                              >
                                <ArrowDown className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => duplicateCompositeLayer(layerId)}
                                title="复制图层"
                                className="p-1.5 rounded text-slate-500 hover:text-zinc-900 hover:bg-zinc-200 transition-all"
                              >
                                <CopyPlus className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => removeCompositeLayer(layerId)}
                                title="移除图层"
                                className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <Layers3 className="h-4 w-4 text-amber-600 shrink-0" />
                            <select
                              value={presetName}
                              onChange={(e) => handleCompositePresetChange(layerId, e.target.value as PartPresetName)}
                              className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-slate-100 outline-none focus:border-yellow-300"
                            >
                              {PART_PRESET_OPTIONS.map((option) => (
                                <option key={option} value={option} className="bg-white">
                                  拼好模: {option}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary bar */}
                  <div className="flex items-center justify-between px-4 py-3 rounded bg-white border border-zinc-200">
                    <div className="flex items-center gap-2 text-sm">
                      <Layers3 className="w-4 h-4 text-amber-600" />
                      <span className="text-slate-400">共 <strong className="text-zinc-900">{compositeLayerCount}</strong> 层</span>
                    </div>
                    <span className="text-sm font-mono font-bold text-amber-600">
                      {totalSize > 0 ? formatSize(totalSize) : '计算大小中…'}
                    </span>
                  </div>

                  {/* Composite actions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={handlePreviewComposite}
                      disabled={anyDownloading || compositeLayerCount === 0}
                      className="py-3 rounded border border-zinc-300 bg-amber-600 font-bold text-sm text-white flex items-center justify-center gap-2 hover:bg-amber-700 disabled:opacity-50 transition-all"
                    >
                      <Eye className="w-4 h-4" />
                      预览拼好模
                    </button>
                    <button
                      onClick={handleDownloadComposite}
                      disabled={anyDownloading || compositeLayerCount === 0}
                      className="py-3 rounded border-2 border-yellow-300 bg-yellow-300 text-black font-bold text-sm flex items-center justify-center gap-2 hover:bg-zinc-100 disabled:opacity-50 transition-all"
                    >
                      {isDownloadingComposite ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      下载拼好模 ZIP
                    </button>
                  </div>
                  {compositeStatus && (
                    <p className="text-[11px] font-bold text-slate-300">{compositeStatus}</p>
                  )}
                </div>
              ) : (
                <div className="py-14 text-center rounded border-2 border-dashed border-zinc-200">
                  <div className="w-12 h-12 rounded bg-white flex items-center justify-center mx-auto mb-3">
                    <Boxes className="w-6 h-6 text-slate-700" />
                  </div>
                  <h4 className="font-bold text-slate-500 mb-1">工作区为空</h4>
                  <p className="text-slate-600 text-xs">在模型库中点击「加层」以把模型作为图层加入拼好模</p>
                </div>
              )}
            </div>
          )}

        </section>

          {/* ===== RIGHT: Preview ===== */}
          <section className="lg:col-span-7 lg:sticky lg:top-8">

            {/* Preview Window */}
            <div className="rounded overflow-hidden border border-zinc-200 bg-white flex flex-col w-full" style={{ height: '680px' }}>
              <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-amber-600">
                  <Eye className="w-5 h-5" />
                  <h2 className="text-lg font-bold">预览视窗</h2>
                </div>
                {isCompositePreview ? (
                  <span className="text-[11px] font-bold px-3 py-1 bg-zinc-100 text-amber-600 rounded border border-zinc-300">
                    拼好模 · {compositeLayerCount} 层
                  </span>
                ) : previewCostume && (
                  <span className="text-[11px] font-bold px-3 py-1 bg-zinc-100 text-amber-600 rounded border border-zinc-300">
                    {previewCostume}
                  </span>
                )}
              </div>

              <div className="flex-grow relative">
                {isPreviewLoading && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-100/90">
                    <Loader2 className="w-10 h-10 text-amber-600 animate-spin mb-3" />
                    <span className="text-amber-600 text-xs font-black uppercase tracking-widest">Loading Model…</span>
                  </div>
                )}

                {isCompositePreview && compositeLayers.length > 0 ? (
                  <div className="w-full h-full relative">
                    <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-300 bg-zinc-100/90 p-2">
                      <div className="flex items-center gap-2 px-2 text-xs font-bold text-amber-700">
                        <Layers3 className="h-4 w-4" />
                        <span>拼好模预览</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {compositeLayerRows.map((row, index) => `L${index + 1} ${row.modelName}:${row.presetName}`).join(' / ')}
                      </span>
                    </div>
                    <CompositeLive2dPreview
                      key={compositeLayerRows.map((row) => `${row.layerId}:${row.modelName}:${row.presetName}`).join('|')}
                      layers={compositeLayers}
                      partIdCache={compositePartIdCache.current}
                    />
                    <div className="absolute bottom-3 left-3 px-3 py-1 rounded bg-zinc-200 text-[10px] font-black text-amber-600 border border-zinc-300">
                      COMPOSITE JSONL
                    </div>
                  </div>
                ) : previewCostume && previewBuildData ? (
                  <div className="w-full h-full relative">
                    <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center gap-2 rounded border border-zinc-300 bg-zinc-100/90 p-2">
                      <select
                        value={selectedMotion}
                        onChange={(e) => setSelectedMotion(e.target.value)}
                        className="min-w-[160px] flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none"
                      >
                        {motionOptions.length === 0 && (
                          <option value="idle" className="bg-white">动作: idle</option>
                        )}
                        {motionOptions.map((motion) => (
                          <option key={motion} value={motion} className="bg-white">
                            动作: {motion}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedExpression}
                        onChange={(e) => setSelectedExpression(e.target.value)}
                        className="min-w-[160px] flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none"
                      >
                        <option value="" className="bg-white">表情: 默认</option>
                        {expressionOptions.map((expression) => (
                          <option key={expression} value={expression} className="bg-white">
                            表情: {expression}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleCopyPreview}
                        className="inline-flex items-center gap-2 rounded border border-zinc-300 bg-zinc-100 px-3 py-2 text-xs font-bold text-amber-600 transition-colors hover:bg-zinc-200"
                      >
                        <Copy className="h-4 w-4" />
                        复制图片
                      </button>
                      <button
                        onClick={handleDownloadPreviewImage}
                        className="inline-flex items-center gap-2 rounded border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-300 transition-colors hover:bg-blue-500/20"
                      >
                        <Download className="h-4 w-4" />
                        下载截图
                      </button>
                      {copyStatus && (
                        <span className="text-[11px] font-bold text-slate-300">{copyStatus}</span>
                      )}
                    </div>
                    <Live2dPreview
                      ref={previewRef}
                      key={previewCostume}
                      modelName={previewCostume}
                      buildData={previewBuildData}
                      selectedMotion={selectedMotion}
                      selectedExpression={selectedExpression}
                    />
                    <div className="absolute bottom-3 left-3 px-3 py-1 rounded bg-zinc-200 text-[10px] font-black text-amber-600 border border-zinc-300">
                      CUBISM 2.1
                    </div>
                  </div>
                ) : showCompositeHint ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <div className="w-16 h-16 rounded bg-zinc-100 flex items-center justify-center mb-5 ring-1 ring-zinc-700">
                      <Boxes className="w-8 h-8 text-amber-600" />
                    </div>
                    <h3 className="text-slate-300 font-bold text-lg mb-2">拼好模工作区已就绪</h3>
                    <p className="text-slate-500 text-sm max-w-xs mb-6">已加入 {compositeLayerCount} 个图层，点击下方按钮在预览窗中查看合成效果</p>
                    <button
                      onClick={handlePreviewComposite}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded border border-zinc-300 bg-zinc-100 font-bold text-sm text-amber-700 hover:bg-zinc-200 transition-all"
                    >
                      <Eye className="w-4 h-4" />
                      预览拼好模
                    </button>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <div className="w-16 h-16 rounded bg-white flex items-center justify-center mb-5 ring-1 ring-white/[0.06]">
                      <Eye className="w-8 h-8 text-slate-700" />
                    </div>
                    <h3 className="text-slate-500 font-bold text-lg mb-2">等待预览</h3>
                    <p className="text-slate-600 text-sm max-w-xs">点击左侧列表中的「预览」按钮查看模型，再次点击可关闭</p>
                  </div>
                )}
              </div>
            </div>

          </section>
        </div>
      </div>

      {/* Import table modal */}
      {showImportTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowImportTable(false)}>
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative w-full max-w-lg bg-white border-2 border-zinc-300 rounded flex flex-col overflow-hidden shadow-2xl" style={{ maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between shrink-0">
              <h2 className="text-lg font-bold">角色 ID 表</h2>
              <button onClick={() => setShowImportTable(false)} className="p-2 rounded text-slate-500 hover:text-zinc-900 hover:bg-zinc-100/[0.06] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-zinc-200 shrink-0">
              <input
                autoFocus
                type="text"
                placeholder="搜索 ID / 中文 / 日文 / 英文…"
                value={importSearch}
                onChange={(e) => setImportSearch(e.target.value)}
                className="w-full px-3 py-2 rounded bg-zinc-100 border border-zinc-300 text-sm outline-none focus:border-violet-500/40 placeholder:text-slate-600"
              />
            </div>
            <div className="overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="sticky top-0 bg-white text-slate-500">
                    <th className="text-left px-4 py-2 font-semibold w-12">ID</th>
                    <th className="text-left px-4 py-2 font-semibold">中文</th>
                    <th className="text-left px-4 py-2 font-semibold">日文</th>
                    <th className="text-left px-4 py-2 font-semibold">English</th>
                  </tr>
                </thead>
                <tbody>
                  {nameImportList
                    .filter((e) => {
                      const kw = importSearch.trim().toLowerCase();
                      if (!kw) return true;
                      return [String(e.import), e.name_zh, e.name_ja, e.name_en].some((v) => v.toLowerCase().includes(kw));
                    })
                    .map((e) => (
                      <tr key={e.import} className={`border-t border-zinc-200 ${e.import === matchedImportValue ? 'bg-violet-500/15' : 'hover:bg-zinc-100'}`}>
                        <td className="px-4 py-2 font-mono font-bold text-violet-400">{e.import}</td>
                        <td className="px-4 py-2 text-slate-300">{e.name_zh}</td>
                        <td className="px-4 py-2 text-slate-500">{e.name_ja}</td>
                        <td className="px-4 py-2 text-slate-600">{e.name_en}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;