import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchCharaRoster, fetchAssetsIndex, fetchBuildData, fetchModelSize, formatSize, getFileCount, fetchCostumes } from './api/bestdori';
import { CharaRoster, BuildData, CostumeMap } from './types';
import Live2dPreview from './components/Live2dPreview';
import { downloadModelsAsZip } from './utils/zip';
import { Search, Download, Eye, Loader2, Sparkles, User, Package, CheckCircle2, X, HardDrive, FileBox } from 'lucide-react';

function App() {
  const [roster, setRoster] = useState<CharaRoster | null>(null);
  const [assetsIndex, setAssetsIndex] = useState<any>(null);
  const [costumeMap, setCostumeMap] = useState<CostumeMap | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [costumes, setCostumes] = useState<string[]>([]);
  const [matchedCharaName, setMatchedCharaName] = useState('');

  // Preview (single)
  const [previewCostume, setPreviewCostume] = useState<string | null>(null);
  const [previewBuildData, setPreviewBuildData] = useState<BuildData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Selection (multi)
  const [selectedMap, setSelectedMap] = useState<Map<string, BuildData>>(new Map());
  const [modelSizes, setModelSizes] = useState<Map<string, number>>(new Map());
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  const initDone = useRef(false);
  const buildDataCache = useRef<Map<string, BuildData>>(new Map());
  const costumeByAsset = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!costumeMap) return m;
    Object.values(costumeMap).forEach((c) => {
      if (c?.assetBundleName) m.set(c.assetBundleName, c.description || []);
    });
    return m;
  }, [costumeMap]);

  const getCachedBuildData = async (name: string): Promise<BuildData> => {
    const cached = buildDataCache.current.get(name);
    if (cached) return cached;
    const data = await fetchBuildData(name);
    buildDataCache.current.set(name, data);
    return data;
  };

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    (async () => {
      try {
        const [r, a, c] = await Promise.all([fetchCharaRoster(), fetchAssetsIndex(), fetchCostumes()]);
        const custom: CharaRoster = {
          '337': { characterType: 'common', characterName: ['三角 初華', 'Uika Misumi', '三角 初華', '三角 初华'], nickname: [null, null, null, null, null] },
          '338': { characterType: 'common', characterName: ['若葉 睦', 'Mutsumi Wakaba', '若葉 睦', '若叶 睦'], nickname: [null, null, null, null, null] },
          '339': { characterType: 'common', characterName: ['八幡 海鈴', 'Umiri Yahata', '八幡 海鈴', '八幡 海铃'], nickname: [null, null, null, null, null] },
          '340': { characterType: 'common', characterName: ['祐天寺 にゃむ', 'Nyamu Yūtenji', '祐天寺 若麦', '祐天寺 喵梦'], nickname: [null, null, null, null, null] },
          '341': { characterType: 'common', characterName: ['豊川 祥子', 'Sakiko Togawa', '豊川 祥子', '丰川祥子'], nickname: [null, null, null, null, null] },
        };
        setRoster({ ...r, ...custom });
        setAssetsIndex(a);
        setCostumeMap(c);
      } catch (e) {
        console.error('Init failed:', e);
      }
    })();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roster) return;

    const term = searchTerm.trim().toLowerCase();
    if (!term) return;

    const assets = assetsIndex?.live2d?.chara || {};
    const models = Object.keys(assets).filter((n) => !n.endsWith('general'));

    const candidates = models.map((model) => {
      const charaId = String(parseInt(model.slice(0, 3), 10));
      const chara = roster[charaId];
      const names = [...(chara?.characterName || []), ...((chara?.nickname || []).filter(Boolean) as string[])];
      const costumeNames = costumeByAsset.get(model) || [];
      const searchable = [
        model,
        ...names,
        ...costumeNames,
        ...costumeNames.map((c) => `${names[0] || ''} ${c}`),
      ]
        .filter(Boolean)
        .join(' | ')
        .toLowerCase();
      return { model, charaId, names, costumeNames, searchable };
    });

    const matched = candidates.filter((c) => c.searchable.includes(term) || term.includes(c.model.toLowerCase()));
    if (matched.length === 0) {
      setMatchedCharaName('');
      setCostumes([]);
      setPreviewCostume(null);
      setPreviewBuildData(null);
      return;
    }

    const first = matched[0];
    const charaOnlyHit = first.names.some((n) => n.toLowerCase().includes(term) || term.includes(n.toLowerCase()));
    const sameCharaMatched = matched.filter((m) => m.charaId === first.charaId);
    const target =
      charaOnlyHit
        ? models.filter((n) => n.startsWith(first.model.slice(0, 3)) && !n.endsWith('general'))
        : sameCharaMatched.map((m) => m.model);

    const uniqueTarget = Array.from(new Set(target)).sort();
    const label = first.names[0] || first.model.slice(0, 3);
    setMatchedCharaName(charaOnlyHit ? label : `${label}（匹配 ${uniqueTarget.length} 套）`);
    setCostumes(uniqueTarget);
    setPreviewCostume(null);
    setPreviewBuildData(null);

    // Pre-fetch all buildData in background so buttons respond instantly
    uniqueTarget.forEach((name) => {
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
      return;
    }
    setIsPreviewLoading(true);
    try {
      const data = await getCachedBuildData(name);
      setPreviewBuildData(data);
      setPreviewCostume(name);
    } catch (e) {
      console.error('Preview failed:', e);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [previewCostume]);

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
        setDownloadProgress(`${cur} / ${total} 模型已打包`);
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
        <p className="text-slate-500 text-base tracking-wide">
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

          {/* ===== LEFT: Model List ===== */}
          <section className="lg:col-span-5 rounded-3xl overflow-hidden border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm flex flex-col" style={{ height: '720px' }}>
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
                        {!isSelected && (costumeByAsset.get(costume)?.[3] || costumeByAsset.get(costume)?.[0]) && (
                          <span className="text-[10px] text-slate-500 truncate block">
                            {costumeByAsset.get(costume)?.[3] || costumeByAsset.get(costume)?.[0]}
                          </span>
                        )}
                        {isSelected && size !== undefined && (
                          <span className="text-[10px] text-slate-500 font-mono">{formatSize(size)}</span>
                        )}
                      </div>
                    </div>

                    {/* Right: buttons */}
                    <div className="flex gap-1.5 shrink-0">
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
          </section>

          {/* ===== RIGHT: Preview + Download ===== */}
          <section className="lg:col-span-7 flex flex-col gap-8 lg:sticky lg:top-8">

            {/* Preview Window */}
            <div className="rounded-3xl overflow-hidden border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm flex flex-col" style={{ height: '500px' }}>
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
                    <Live2dPreview key={previewCostume} modelName={previewCostume} buildData={previewBuildData} />
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

            {/* Download Card */}
            <div className="rounded-3xl overflow-hidden border border-white/[0.06] bg-gradient-to-br from-blue-600/10 to-violet-600/10 backdrop-blur-sm p-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-blue-500 text-white shadow-lg shadow-blue-600/20">
                    <Download className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">下载队列</h3>
                    <p className="text-slate-500 text-sm">支持多选，所有模型将打包到一个 ZIP</p>
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
                    {isDownloading ? downloadProgress || '打包中…' : `打包下载 ${selectedCount} 个模型 (.ZIP)`}
                  </button>
                </div>
              ) : (
                <div className="py-14 text-center rounded-2xl border-2 border-dashed border-white/[0.06]">
                  <Package className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-600 font-bold text-sm">点击左侧「选择」按钮添加模型到队列</p>
                  <p className="text-slate-700 text-xs mt-1">支持多选，再次点击可取消选择</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
