import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchCharaRoster, fetchAssetsIndex, fetchBuildData, fetchModelSize, formatSize, getFileCount, fetchCostumes, fetchCards } from './api/bestdori';
import { CharaRoster, BuildData, CardInfo, CardMap, CostumeInfo, CostumeMap, CompositeLayerDraft, PartCategory } from './types';
import Live2dPreview, { Live2dPreviewHandle } from './components/Live2dPreview';
import CompositeLive2dPreview, { CompositeLive2dPreviewHandle } from './components/CompositeLive2dPreview';
import { getAssetsBase } from './config';
import { downloadModelsAsZip } from './utils/zip';
import { downloadCompositeZip, downloadWmdlZip, getCompositeExpressionOptions, getCompositeMotionOptions } from './utils/composite';
import { searchLive2dModels } from './utils/search';
import { CUSTOM_CHARA_ROSTER } from './data/customCharacters';
import { PART_CATEGORIES } from './data/partPresets';
import { Search, Download, Eye, Loader2, Sparkles, User, Package, CheckCircle2, X, HardDrive, FileBox, Copy, Layers3, Boxes } from 'lucide-react';

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

type PartAssignment = Record<PartCategory, string | null>;
const EMPTY_ASSIGNMENT: PartAssignment = { 后发: null, 身体: null, 脸: null, 帽子: null };

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
  const [selectedMotion, setSelectedMotion] = useState('');
  const [selectedExpression, setSelectedExpression] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [nameImportList, setNameImportList] = useState<Array<{import: number; name_ja: string; name_en: string; name_zh: string}>>([]);
  const [showImportTable, setShowImportTable] = useState(false);
  const [importSearch, setImportSearch] = useState('');
  const previewRef = useRef<Live2dPreviewHandle | null>(null);
  const compositePreviewRef = useRef<CompositeLive2dPreviewHandle | null>(null);

  // Selection (shared by both modes — each selected model becomes a layer row)
  const [selectedMap, setSelectedMap] = useState<Map<string, BuildData>>(new Map());
  const [modelSizes, setModelSizes] = useState<Map<string, number>>(new Map());

  // Per-model ZIP download
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  // Composite (拼好模)
  const [slotAssignment, setSlotAssignment] = useState<PartAssignment>({ ...EMPTY_ASSIGNMENT });
  const [isCompositePreview, setIsCompositePreview] = useState(false);
  const [isDownloadingComposite, setIsDownloadingComposite] = useState(false);
  const [compositeStatus, setCompositeStatus] = useState('');
  const [compositeImportStr, setCompositeImportStr] = useState('');

  const initDone = useRef(false);
  const buildDataCache = useRef<Map<string, BuildData>>(new Map());
  const compositePartIdCache = useRef<Map<string, string[]>>(new Map());
  const nameImportMap = useRef<Map<string, number>>(new Map());
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

  const compositeLayers = useMemo<CompositeLayerDraft[]>(() => {
    // 按 PART_CATEGORIES 顺序（后发→身体→脸→帽子 = 底→顶）遍历，
    // 相邻且同一模型的槽合并为一层，非相邻的拆成独立层。
    const slots = PART_CATEGORIES
      .filter((cat) => { const m = slotAssignment[cat]; return !!m && selectedMap.has(m); })
      .map((cat) => ({ cat, model: slotAssignment[cat]! }));

    const groups: { model: string; cats: PartCategory[] }[] = [];
    for (const slot of slots) {
      const last = groups[groups.length - 1];
      if (last && last.model === slot.model) { last.cats.push(slot.cat); }
      else { groups.push({ model: slot.model, cats: [slot.cat] }); }
    }

    return groups.map(({ model, cats }, i) => ({
      layerId: `${model}_${cats.join('_')}_${i}`,
      modelName: model,
      buildData: selectedMap.get(model)!,
      partCategories: cats,
      characterNames: roster?.[String(parseInt(model.slice(0, 3), 10))]?.characterName || [],
    }));
  }, [slotAssignment, selectedMap, roster]);

  const compositeMotionOptions = useMemo(
    () => getCompositeMotionOptions(compositeLayers),
    [compositeLayers]
  );

  const compositeExpressionOptions = useMemo(
    () => getCompositeExpressionOptions(compositeLayers),
    [compositeLayers]
  );

  const matchedImportValue = useMemo(() => {
    if (!matchedCharaName) return undefined;
    return nameImportMap.current.get(matchedCharaName.replace(/\s/g, '').toLowerCase());
  }, [matchedCharaName]);

  const compositeImportValue = useMemo(() => {
    const raw = compositeImportStr.trim();
    if (!raw) return matchedImportValue;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [compositeImportStr, matchedImportValue]);

  useEffect(() => {
    setCompositeImportStr(matchedImportValue !== undefined ? String(matchedImportValue) : '');
  }, [matchedImportValue]);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    // name_import.json独立加载，不依赖 Bestdori API
    fetch('/name_import.json').then((res) => res.json()).then((nameImport) => {
      setNameImportList(nameImport);
      const nim = new Map<string, number>();
      (nameImport as Array<{import: number; name_ja: string; name_en: string; name_zh: string}>).forEach((e) => {
        [e.name_ja, e.name_en, e.name_zh].forEach((n) => nim.set(n.replace(/\s/g, '').toLowerCase(), e.import));
      });
      nameImportMap.current = nim;
    }).catch((e) => console.error('name_import load failed:', e));
    (async () => {
      try {
        const [r, a, c, cards] = await Promise.all([
          fetchCharaRoster(), fetchAssetsIndex(), fetchCostumes(), fetchCards(),
        ]);
        setRoster({ ...r, ...CUSTOM_CHARA_ROSTER });
        setAssetsIndex(a);
        setCostumeMap(c);
        setCardMap(cards);
      } catch (e) {
        console.error('Init failed:', e);
      }
    })();
  }, []);

  const performSearch = (term: string) => {
    if (!roster || !term.trim()) return;
    const assets = assetsIndex?.live2d?.chara || {};
    const result = searchLive2dModels({ roster, assets, costumeByAsset, query: term.trim() });
    if (!result) { setMatchedCharaName(''); setCostumes([]); setPreviewCostume(null); setPreviewBuildData(null); return; }
    setMatchedCharaName(result.label);
    setCostumes(result.models);
    setPreviewCostume(null);
    setPreviewBuildData(null);
    result.models.forEach((name) => {
      if (!buildDataCache.current.has(name)) fetchBuildData(name).then((data) => buildDataCache.current.set(name, data)).catch(() => {});
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(searchTerm);
  };

  // Toggle preview
  const handlePreview = useCallback(async (name: string) => {
    if (previewCostume === name) {
      setPreviewCostume(null);
      setPreviewBuildData(null);
      setSelectedMotion('');
      setSelectedExpression('');
      setCopyStatus('');
      return;
    }
    setIsCompositePreview(false);
    setIsPreviewLoading(true);
    try {
      const data = await getCachedBuildData(name);
      setSelectedMotion('');
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
    const currentPreview = isCompositePreview ? compositePreviewRef.current : previewRef.current;
    if (!currentPreview || (!isCompositePreview && !previewCostume)) return;
    try {
      const modelName = isCompositePreview ? (slotAssignment['脸'] ?? '') : (previewCostume ?? '');
      const charaId = parseInt(modelName.slice(0, 3), 10);
      const entry = nameImportList.find((e) => e.import === charaId);
      const firstName = entry ? entry.name_en.split(' ')[0] : modelName;
      const parts = [firstName, selectedMotion, selectedExpression].filter(Boolean);
      const fileName = safeDownloadFileName(parts.join('_')) + '.webp';
      await currentPreview.downloadImage(fileName);
      setCopyStatus('截图已下载');
      window.setTimeout(() => setCopyStatus(''), 1800);
    } catch (e) {
      setCopyStatus(e instanceof Error ? e.message : '下载失败');
      window.setTimeout(() => setCopyStatus(''), 2200);
    }
  }, [isCompositePreview, previewCostume, slotAssignment, selectedMotion, selectedExpression, nameImportList]);

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

  const handleSelect = useCallback(async (name: string) => {
    if (selectedMap.has(name)) {
      setSelectedMap((prev) => { const next = new Map(prev); next.delete(name); return next; });
      setModelSizes((prev) => { const next = new Map(prev); next.delete(name); return next; });
      setSlotAssignment((prev) => {
        const next = { ...prev } as PartAssignment;
        for (const cat of PART_CATEGORIES) if (next[cat] === name) next[cat] = null;
        return next;
      });
      return;
    }
    try {
      const data = await getCachedBuildData(name);
      setSelectedMap((prev) => new Map(prev).set(name, data));
      if (!modelSizes.has(name)) {
        fetchModelSize(data).then((size) => setModelSizes((prev) => new Map(prev).set(name, size)));
      }
    } catch (e) {
      console.error('Select failed:', e);
    }
  }, [selectedMap, modelSizes]);

  const handleRemoveSelected = (name: string) => {
    setSelectedMap((prev) => { const next = new Map(prev); next.delete(name); return next; });
    setModelSizes((prev) => { const next = new Map(prev); next.delete(name); return next; });
    setSlotAssignment((prev) => {
      const next = { ...prev } as PartAssignment;
      for (const cat of PART_CATEGORIES) if (next[cat] === name) next[cat] = null;
      return next;
    });
  };

  const handleClearAll = () => {
    setSelectedMap(new Map());
    setModelSizes(new Map());
    setSlotAssignment({ ...EMPTY_ASSIGNMENT });
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

  const handlePreviewComposite = () => {
    if (compositeLayers.length === 0) return;
    setPreviewCostume(null);
    setPreviewBuildData(null);
    setSelectedMotion('');
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
      await downloadCompositeZip(compositeLayers, compositePartIdCache.current, compositeImportValue);
      setCompositeStatus('拼好模 ZIP 已生成');
    } catch (e) {
      console.error('Composite download failed:', e);
      setCompositeStatus(e instanceof Error ? e.message : '拼好模 ZIP 生成失败');
    } finally {
      setIsDownloadingComposite(false);
    }
  };

  const handleDownloadWmdl = async () => {
    if (compositeLayers.length === 0 || isDownloadingComposite) return;
    setIsDownloadingComposite(true);
    setCompositeStatus('正在生成 WMDL ZIP…');
    try {
      const faceModel = slotAssignment['脸'];
      const charaId = faceModel ? parseInt(faceModel.slice(0, 3), 10) : NaN;
      const entry = nameImportList.find((e) => e.import === charaId);
      const charName = entry?.name_zh?.split(/\s/)[0] || (faceModel ?? '拼好模');
      const name = `${charName} 拼好模`;
      await downloadWmdlZip(compositeLayers, compositePartIdCache.current, name, compositeImportValue);
      setCompositeStatus('WMDL ZIP 已生成');
    } catch (e) {
      console.error('WMDL download failed:', e);
      setCompositeStatus(e instanceof Error ? e.message : 'WMDL ZIP 生成失败');
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
            className="shrink-0 px-4 sm:px-8 py-4 bg-yellow-300 text-black font-black text-base hover:bg-zinc-100 active:scale-95 transition-all"
          >
            <Search className="w-5 h-5 sm:hidden" />
            <span className="hidden sm:inline">搜索</span>
          </button>
          <button
            type="button"
            onClick={() => { setShowImportTable(true); setImportSearch(''); }}
            className="shrink-0 px-3 sm:px-5 py-4 border-2 border-zinc-300 bg-white font-bold text-xs sm:text-sm text-zinc-500 hover:text-amber-600 hover:border-yellow-300 transition-all whitespace-nowrap"
          >
            ID表
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
                        title={isSelected ? '取消选择' : (mode === 'composite' ? '加入候选池' : '加入下载队列')}
                        className={`px-3 py-2 rounded text-xs font-bold flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'bg-yellow-300 text-black'
                            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'
                        }`}
                      >
                        {isSelected ? <CheckCircle2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                        {isSelected ? '已加' : (mode === 'composite' ? '加入' : '选择')}
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
            <div className="rounded overflow-hidden border-2 border-zinc-300 bg-zinc-50 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-base font-bold text-zinc-900">拼好模工作区</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {selectedCount > 0 ? `${selectedCount} 套服装可用，点击下方分配部位` : '在模型库中点击「加入」以添加候选服装'}
                  </p>
                </div>
                {(selectedCount > 0 || compositeLayers.length > 0) && (
                  <button onClick={handleClearAll} className="text-xs text-zinc-400 hover:text-red-500 transition-colors font-bold">
                    清空
                  </button>
                )}
              </div>

              {/* Part assignment grid */}
              <div className="space-y-2 mb-4">
                {PART_CATEGORIES.map((cat) => {
                  const assigned = slotAssignment[cat];
                  return (
                    <div key={cat} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-500 w-8 shrink-0 text-right">{cat}</span>
                      <select
                        value={assigned ?? ''}
                        onChange={(e) => setSlotAssignment((prev) => ({ ...prev, [cat]: e.target.value || null }))}
                        className="flex-1 border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-amber-500 transition-colors"
                      >
                        <option value="">— 未分配 —</option>
                        {Array.from(selectedMap.keys()).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                      {assigned && (
                        <button
                          onClick={() => setSlotAssignment((prev) => ({ ...prev, [cat]: null }))}
                          className="text-zinc-400 hover:text-red-500 transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Derived layers summary */}
              {compositeLayers.length > 0 && (
                <div className="border border-zinc-200 bg-white px-3 py-2 mb-4 text-xs text-zinc-600 space-y-0.5">
                  <span className="font-bold text-zinc-900">→ 生成 {compositeLayers.length} 层</span>
                  {compositeLayers.map((l) => (
                    <div key={l.modelName} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-amber-500 shrink-0" />
                      <span className="font-mono text-amber-600 truncate">{l.modelName}</span>
                      <span className="text-zinc-400">({l.partCategories.join(' + ')})</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Import value */}
              <div className="flex items-center gap-2 mb-4">
                <label className="text-xs font-bold text-zinc-500 shrink-0">import</label>
                <input
                  type="number"
                  min={0}
                  placeholder={matchedImportValue !== undefined ? String(matchedImportValue) : '未设置'}
                  value={compositeImportStr}
                  onChange={(e) => setCompositeImportStr(e.target.value)}
                  className="w-24 border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-amber-500"
                />
                {compositeImportStr && (
                  <button onClick={() => setCompositeImportStr(matchedImportValue !== undefined ? String(matchedImportValue) : '')} className="text-[10px] text-zinc-400 hover:text-zinc-600">重置</button>
                )}
                <span className="text-[10px] text-zinc-400">写入 composite.jsonl summary</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handlePreviewComposite}
                  disabled={anyDownloading || compositeLayers.length === 0}
                  className="py-2.5 border border-zinc-300 bg-white text-sm font-bold text-zinc-700 flex items-center justify-center gap-2 hover:bg-zinc-100 disabled:opacity-40 transition-all"
                >
                  <Eye className="w-4 h-4" />
                  预览
                </button>
                <button
                  onClick={handleDownloadComposite}
                  disabled={anyDownloading || compositeLayers.length === 0}
                  className="py-2.5 border border-zinc-300 bg-white text-xs font-bold text-zinc-700 flex items-center justify-center gap-1 hover:bg-zinc-100 disabled:opacity-40 transition-all"
                >
                  {isDownloadingComposite ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  JSONL
                </button>
                <button
                  onClick={handleDownloadWmdl}
                  disabled={anyDownloading || compositeLayers.length === 0}
                  className="py-2.5 border-2 border-yellow-300 bg-yellow-300 text-black text-xs font-bold flex items-center justify-center gap-1 hover:bg-zinc-100 disabled:opacity-40 transition-all"
                >
                  {isDownloadingComposite ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  WMDL
                </button>
              </div>
              {compositeStatus && <p className="text-xs font-bold text-zinc-600 mt-2">{compositeStatus}</p>}
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
                    <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center gap-2 rounded border border-zinc-300 bg-zinc-100/90 p-2">
                      <div className="flex items-center gap-2 px-2 text-xs font-bold text-amber-700">
                        <Layers3 className="h-4 w-4" />
                        <span>拼好模预览</span>
                      </div>
                      <select
                        value={selectedMotion}
                        disabled={compositeMotionOptions.length === 0}
                        onChange={(e) => setSelectedMotion(e.target.value)}
                        className="min-w-[150px] flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none disabled:opacity-50"
                      >
                        <option value="" className="bg-white">动作: 无</option>
                        {compositeMotionOptions.map((motion) => (
                          <option key={motion} value={motion} className="bg-white">
                            动作: {motion}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedExpression}
                        disabled={compositeExpressionOptions.length === 0}
                        onChange={(e) => setSelectedExpression(e.target.value)}
                        className="min-w-[150px] flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none disabled:opacity-50"
                      >
                        <option value="" className="bg-white">表情: 无</option>
                        {compositeExpressionOptions.map((expression) => (
                          <option key={expression} value={expression} className="bg-white">
                            表情: {expression}
                          </option>
                        ))}
                      </select>
                      <span className="min-w-0 flex-[1.2] truncate text-[11px] text-slate-400">
                        {compositeLayers.map((l, i) => `L${i+1} ${l.modelName}`).join(" / ")}
                      </span>
                      <button
                        onClick={handleDownloadPreviewImage}
                        className="inline-flex items-center gap-2 rounded border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-500/20"
                      >
                        <Download className="h-4 w-4" />
                        下载截图
                      </button>
                      {copyStatus && (
                        <span className="text-[11px] font-bold text-amber-700">{copyStatus}</span>
                      )}
                    </div>
                    <CompositeLive2dPreview
                      ref={compositePreviewRef}
                      key={compositeLayers.map((l) => l.modelName).join("|")}
                      layers={compositeLayers}
                      partIdCache={compositePartIdCache.current}
                      importValue={compositeImportValue}
                      selectedMotion={selectedMotion}
                      selectedExpression={selectedExpression}
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
                        <option value="" className="bg-white">动作: 无</option>
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
                    <th className="w-8" />
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
                      <tr key={e.import} className={`border-t border-zinc-200 ${e.import === matchedImportValue ? 'bg-amber-50' : 'hover:bg-zinc-100'}`}>
                        <td className="px-4 py-2 font-mono font-bold text-amber-600">{e.import}</td>
                        <td className="px-4 py-2 text-zinc-700">{e.name_zh}</td>
                        <td className="px-4 py-2 text-zinc-500">{e.name_ja}</td>
                        <td className="px-4 py-2 text-zinc-400">{e.name_en}</td>
                        <td className="px-2 py-1">
                          <button
                            onClick={() => { setSearchTerm(e.name_zh); performSearch(e.name_zh); setShowImportTable(false); }}
                            title="查看立绘"
                            className="px-2 py-1 text-[10px] font-bold border border-zinc-300 hover:border-amber-500 hover:text-amber-600 transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                          </button>
                        </td>
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
