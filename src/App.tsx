import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchCharaRoster, fetchAssetsIndex, fetchBuildData, fetchModelSize, formatSize, getFileCount, fetchCostumes, fetchCards } from './api/bestdori';
import { CharaRoster, BuildData, CardInfo, CardMap, CostumeInfo, CostumeMap } from './types';
import Live2dPreview, { Live2dPreviewHandle } from './components/Live2dPreview';
import { getAssetsBase } from './config';
import { downloadModelsAsZip } from './utils/zip';
import { searchLive2dModels } from './utils/search';
import { CUSTOM_CHARA_ROSTER } from './data/customCharacters';
import { Search, Download, Eye, Loader2, Sparkles, User, Package, CheckCircle2, X, HardDrive, FileBox, Copy } from 'lucide-react';

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

  // Preview (single)
  const [previewCostume, setPreviewCostume] = useState<string | null>(null);
  const [previewBuildData, setPreviewBuildData] = useState<BuildData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [selectedMotion, setSelectedMotion] = useState('idle');
  const [selectedExpression, setSelectedExpression] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const previewRef = useRef<Live2dPreviewHandle | null>(null);

  // Selection (multi)
  const [selectedMap, setSelectedMap] = useState<Map<string, BuildData>>(new Map());
  const [modelSizes, setModelSizes] = useState<Map<string, number>>(new Map());
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  const initDone = useRef(false);
  const buildDataCache = useRef<Map<string, BuildData>>(new Map());
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

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    (async () => {
      try {
        const [r, a, c, cards] = await Promise.all([fetchCharaRoster(), fetchAssetsIndex(), fetchCostumes(), fetchCards()]);
        setRoster({ ...r, ...CUSTOM_CHARA_ROSTER });
        setAssetsIndex(a);
        setCostumeMap(c);
        setCardMap(cards);
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

  // Toggle select (multi)
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
      return;
    }
    try {
      const data = await getCachedBuildData(name);
      setSelectedMap((prev) => new Map(prev).set(name, data));
      if (!modelSizes.has(name)) {
        fetchModelSize(data).then((size) => {
          setModelSizes((prev) => new Map(prev).set(name, size));
        });
      }
    } catch (e) {
      console.error('Select failed:', e);
    }
  }, [selectedMap, modelSizes]);

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
  };

  const handleClearAll = () => {
    setSelectedMap(new Map());
    setModelSizes(new Map());
  };

  const handleDownload = async () => {
    if (selectedMap.size === 0) return;
    setIsDownloading(true);
    setDownloadProgress('准备中…');
    try {
      await downloadModelsAsZip(selectedMap, (cur, total) => {
        setDownloadProgress(`${cur} / ${total} 个已下载`);
      });
    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setIsDownloading(false);
      setDownloadProgress('');
    }
  };

  const totalSize = Array.from(modelSizes.values()).reduce((s, v) => s + v, 0);
  const selectedCount = selectedMap.size;

  return (
    <div className="min-h-screen text-slate-100 font-sans">
      {/* Ambient */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/4 left-1/4 w-[600px] h-[600px] bg-blue-600/[0.07] blur-[140px] rounded-full" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-violet-600/[0.06] blur-[140px] rounded-full" />
        <div className="absolute top-1/2 left-0 w-[300px] h-[300px] bg-cyan-500/[0.04] blur-[100px] rounded-full" />
      </div>

      {/* Header */}
      <header className="pt-16 pb-10 text-center select-none">
        <div className="inline-flex items-center gap-4 mb-4">
          <Sparkles className="w-9 h-9 text-cyan-400" />
          <h1 className="text-5xl md:text-6xl font-black tracking-tight bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 bg-clip-text text-transparent">
            Live2D Explorer
          </h1>
        </div>
        <p className="text-slate-500 text-base tracking-wide mb-4">
          搜索、预览、打包下载 BanG Dream! Live2D 模型
        </p>
      </header>

      {/* Search */}
      <div className="max-w-2xl mx-auto px-4 mb-14">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-grow">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
            <input
              type="text"
              placeholder="输入角色或服装名 (如: 爱音, ひみつの作戦会議)"
              className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/30 outline-none text-lg placeholder:text-slate-600 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="px-10 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-600 font-bold text-lg hover:shadow-lg hover:shadow-blue-600/20 active:scale-95 transition-all"
          >
            搜 索
          </button>
        </form>
      </div>

      {/* Main */}
      <div className="max-w-7xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* ===== LEFT: Model Library + Download Queue ===== */}
          <section className="lg:col-span-5 flex flex-col gap-8">

            {/* Model Library */}
            <div className="rounded-3xl overflow-hidden border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm flex flex-col" style={{ height: '480px' }}>
            <div className="px-6 py-5 border-b border-white/[0.06] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-500/10">
                  <User className="w-5 h-5 text-blue-400" />
                </div>
                <h2 className="text-lg font-bold">
                  模型库
                  {matchedCharaName && (
                    <span className="ml-2 text-sm font-normal text-slate-500">— {matchedCharaName}</span>
                  )}
                </h2>
              </div>
              <span className="text-[11px] font-mono text-slate-500 bg-white/[0.04] px-3 py-1 rounded-full border border-white/[0.06]">
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
                    className={`group flex items-center justify-between gap-2 p-3 rounded-2xl transition-all duration-200 border ${
                      isSelected ? 'bg-blue-500/10 border-blue-500/20' : 'border-transparent hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Left: indicator + name + size */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${isPreviewing ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-slate-700'}`} />
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
                            className="h-11 w-11 rounded-lg border border-white/10 bg-white/[0.03] object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleDownloadCostumeThumb(costume)}
                            title="下载小图标"
                            className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-md border border-white/15 bg-slate-950/90 text-slate-300 shadow-sm transition-colors hover:border-blue-400/40 hover:bg-blue-500/90 hover:text-white"
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
                          className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all bg-white/[0.04] text-slate-500 hover:bg-emerald-500/15 hover:text-emerald-300"
                        >
                          <Download className="w-4 h-4" />
                          卡面
                        </button>
                      )}
                      <button
                        onClick={() => handlePreview(costume)}
                        title={isPreviewing ? '关闭预览' : '预览'}
                        className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                          isPreviewing
                            ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/25'
                            : 'bg-white/[0.04] text-slate-500 hover:bg-cyan-500/15 hover:text-cyan-400'
                        }`}
                      >
                        <Eye className="w-4 h-4" />
                        {isPreviewing ? '关闭' : '预览'}
                      </button>
                      <button
                        onClick={() => handleSelect(costume)}
                        title={isSelected ? '取消选择' : '选择'}
                        className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'bg-blue-500 text-white shadow-md shadow-blue-500/25'
                            : 'bg-white/[0.04] text-slate-500 hover:bg-blue-500/15 hover:text-blue-400'
                        }`}
                      >
                        {isSelected ? <CheckCircle2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                        {isSelected ? '已选' : '选择'}
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

          {/* Download Queue (moved below model library) */}
          <div className="rounded-3xl overflow-hidden border border-white/[0.06] bg-gradient-to-br from-blue-600/10 to-violet-600/10 backdrop-blur-sm p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-blue-500 text-white shadow-lg shadow-blue-600/20">
                  <Download className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">下载队列</h3>
                  <p className="text-slate-500 text-sm">支持多选，每个模型将单独下载为一个 ZIP</p>
                </div>
              </div>
              {selectedCount > 0 && (
                <button onClick={handleClearAll} className="text-xs text-slate-500 hover:text-red-400 transition-colors font-bold px-3 py-1.5 rounded-lg hover:bg-red-500/10">
                  全部清空
                </button>
              )}
            </div>

            {selectedCount > 0 ? (
              <div className="space-y-4">
                {/* Selected items list */}
                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                  {Array.from(selectedMap.entries()).map(([name, data]) => {
                    const size = modelSizes.get(name);
                    const fileCount = getFileCount(data);
                    return (
                      <div key={name} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] group">
                        <FileBox className="w-5 h-5 text-blue-400 shrink-0" />
                        <div className="flex-grow min-w-0">
                          <p className="font-bold text-sm truncate">{name}</p>
                          <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono mt-0.5">
                            <span>{fileCount} 文件</span>
                            <span>{size !== undefined ? formatSize(size) : '计算中…'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveSelected(name)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Summary bar */}
                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <div className="flex items-center gap-2 text-sm">
                    <HardDrive className="w-4 h-4 text-blue-400" />
                    <span className="text-slate-400">共 <strong className="text-white">{selectedCount}</strong> 个模型</span>
                  </div>
                  <span className="text-sm font-mono font-bold text-blue-400">
                    {totalSize > 0 ? formatSize(totalSize) : '计算大小中…'}
                  </span>
                </div>

                {/* Download button */}
                <button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 font-black text-lg flex items-center justify-center gap-3 hover:shadow-lg hover:shadow-blue-600/25 disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {isDownloading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Download className="w-6 h-6" />}
                  {isDownloading ? downloadProgress || '下载中…' : `下载 ${selectedCount} 个模型（各为独立 ZIP）`}
                </button>
              </div>
            ) : (
              <div className="py-14 text-center rounded-2xl border-2 border-dashed border-white/[0.06]">
                <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
                  <FileBox className="w-6 h-6 text-slate-700" />
                </div>
                <h4 className="font-bold text-slate-500 mb-1">未选择模型</h4>
                <p className="text-slate-600 text-xs">在模型库中点击「选择」以添加到下载队列</p>
              </div>
            )}
          </div>

        </section>

          {/* ===== RIGHT: Preview ===== */}
          <section className="lg:col-span-7 lg:sticky lg:top-8">

            {/* Preview Window */}
            <div className="rounded-3xl overflow-hidden border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm flex flex-col w-full" style={{ height: '680px' }}>
              <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Eye className="w-5 h-5" />
                  <h2 className="text-lg font-bold">预览视窗</h2>
                </div>
                {previewCostume && (
                  <span className="text-[11px] font-bold px-3 py-1 bg-cyan-500/10 text-cyan-400 rounded-lg border border-cyan-500/20">
                    {previewCostume}
                  </span>
                )}
              </div>

              <div className="flex-grow relative">
                {isPreviewLoading && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/70 backdrop-blur-sm">
                    <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mb-3" />
                    <span className="text-cyan-400 text-xs font-black uppercase tracking-widest">Loading Model…</span>
                  </div>
                )}

                {previewCostume && previewBuildData ? (
                  <div className="w-full h-full relative">
                    <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-2 backdrop-blur">
                      <select
                        value={selectedMotion}
                        onChange={(e) => setSelectedMotion(e.target.value)}
                        className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-slate-100 outline-none"
                      >
                        {motionOptions.length === 0 && (
                          <option value="idle" className="bg-slate-900">动作: idle</option>
                        )}
                        {motionOptions.map((motion) => (
                          <option key={motion} value={motion} className="bg-slate-900">
                            动作: {motion}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedExpression}
                        onChange={(e) => setSelectedExpression(e.target.value)}
                        className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-slate-100 outline-none"
                      >
                        <option value="" className="bg-slate-900">表情: 默认</option>
                        {expressionOptions.map((expression) => (
                          <option key={expression} value={expression} className="bg-slate-900">
                            表情: {expression}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleCopyPreview}
                        className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-300 transition-colors hover:bg-cyan-500/20"
                      >
                        <Copy className="h-4 w-4" />
                        复制图片
                      </button>
                      <button
                        onClick={handleDownloadPreviewImage}
                        className="inline-flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-300 transition-colors hover:bg-blue-500/20"
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
                    <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/50 backdrop-blur text-[10px] font-black text-cyan-400 border border-white/10">
                      CUBISM 2.1
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-5 ring-1 ring-white/[0.06]">
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
    </div>
  );
}

export default App;
