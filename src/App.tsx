import { useState, useEffect, useRef } from 'react';
import { fetchCharaRoster, fetchAssetsIndex, fetchBuildData } from './api/bestdori';
import { CharaRoster, BuildData } from './types';
import Live2dPreview from './components/Live2dPreview';
import { downloadModelAsZip } from './utils/zip';
import { Search, Download, Eye, Loader2, Sparkles, User, Package, CheckCircle2 } from 'lucide-react';

function App() {
  const [roster, setRoster] = useState<CharaRoster | null>(null);
  const [assetsIndex, setAssetsIndex] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [costumes, setCostumes] = useState<string[]>([]);
  const [matchedCharaName, setMatchedCharaName] = useState<string>('');

  const [previewCostume, setPreviewCostume] = useState<string | null>(null);
  const [previewBuildData, setPreviewBuildData] = useState<BuildData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const [selectedCostume, setSelectedCostume] = useState<string | null>(null);
  const [selectedBuildData, setSelectedBuildData] = useState<BuildData | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const initDone = useRef(false);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    const init = async () => {
      try {
        const [r, a] = await Promise.all([fetchCharaRoster(), fetchAssetsIndex()]);
        const customChara: CharaRoster = {
          '337': { characterType: 'common', characterName: ['三角 初華', 'Uika Misumi', '三角 初華', '三角 初华'], nickname: [null, null, null, null, null] },
          '338': { characterType: 'common', characterName: ['若葉 睦', 'Mutsumi Wakaba', '若葉 睦', '若叶 睦'], nickname: [null, null, null, null, null] },
          '339': { characterType: 'common', characterName: ['八幡 海鈴', 'Umiri Yahata', '八幡 海鈴', '八幡 海铃'], nickname: [null, null, null, null, null] },
          '340': { characterType: 'common', characterName: ['祐天寺 にゃむ', 'Nyamu Yūtenji', '祐天寺 若麦', '祐天寺 喵梦'], nickname: [null, null, null, null, null] },
          '341': { characterType: 'common', characterName: ['豊川 祥子', 'Sakiko Togawa', '豊川 祥子', '丰川祥子'], nickname: [null, null, null, null, null] },
        };
        setRoster({ ...r, ...customChara });
        setAssetsIndex(a);
      } catch (error) {
        console.error('Failed to init app:', error);
      }
    };
    init();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roster) return;

    const matched = Object.entries(roster).find(([, info]) =>
      info.characterName.some((name) => name?.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (matched) {
      const charaId = matched[0];
      const info = matched[1];
      setMatchedCharaName(info.characterName[0] || '');

      const live2dAssets = assetsIndex?.live2d?.chara || {};
      const charaPrefix = charaId.padStart(3, '0');
      const filtered = Object.keys(live2dAssets).filter(
        (name) => name.startsWith(charaPrefix) && !name.endsWith('general')
      );
      setCostumes(filtered);
      setPreviewCostume(null);
      setPreviewBuildData(null);
    }
  };

  const handlePreview = async (costumeName: string) => {
    if (previewCostume === costumeName) return;
    setIsPreviewLoading(true);
    try {
      const data = await fetchBuildData(costumeName);
      setPreviewBuildData(data);
      setPreviewCostume(costumeName);
    } catch (error) {
      console.error('Preview failed:', error);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleSelect = async (costumeName: string) => {
    if (selectedCostume === costumeName) {
      setSelectedCostume(null);
      setSelectedBuildData(null);
      return;
    }
    try {
      const data = await fetchBuildData(costumeName);
      setSelectedBuildData(data);
      setSelectedCostume(costumeName);
    } catch (error) {
      console.error('Select failed:', error);
    }
  };

  const handleDownload = async () => {
    if (!selectedCostume || !selectedBuildData) return;
    setIsDownloading(true);
    try {
      await downloadModelAsZip(selectedCostume, selectedBuildData);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen text-slate-100 font-sans">
      {/* Ambient background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/4 left-1/4 w-[600px] h-[600px] bg-blue-600/[0.07] blur-[140px] rounded-full" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-violet-600/[0.06] blur-[140px] rounded-full" />
        <div className="absolute top-1/2 left-0 w-[300px] h-[300px] bg-cyan-500/[0.04] blur-[100px] rounded-full" />
      </div>

      {/* ===== HEADER ===== */}
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

      {/* ===== SEARCH ===== */}
      <div className="max-w-2xl mx-auto px-4 mb-14">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-grow">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
            <input
              type="text"
              placeholder="输入角色名 (如: 爱音, 祥子)"
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

      {/* ===== MAIN CONTENT ===== */}
      <div className="max-w-7xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* ====== LEFT: Model List ====== */}
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
                const isSelected = selectedCostume === costume;

                return (
                  <div
                    key={costume}
                    className={`group flex items-center justify-between gap-3 p-3 rounded-2xl transition-all duration-200 border ${
                      isSelected
                        ? 'bg-blue-500/10 border-blue-500/20'
                        : 'border-transparent hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Indicator + Name */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${
                          isPreviewing ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-slate-700'
                        }`}
                      />
                      <span className="font-semibold truncate">{costume}</span>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => handlePreview(costume)}
                        title="预览"
                        className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                          isPreviewing
                            ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/25'
                            : 'bg-white/[0.04] text-slate-500 hover:bg-cyan-500/15 hover:text-cyan-400'
                        }`}
                      >
                        <Eye className="w-4 h-4" />
                        预览
                      </button>
                      <button
                        onClick={() => handleSelect(costume)}
                        title="选择"
                        className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'bg-blue-500 text-white shadow-md shadow-blue-500/25'
                            : 'bg-white/[0.04] text-slate-500 hover:bg-blue-500/15 hover:text-blue-400'
                        }`}
                      >
                        {isSelected ? <CheckCircle2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                        选择
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

          {/* ====== RIGHT: Preview + Download ====== */}
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
                    <p className="text-slate-600 text-sm max-w-xs">点击左侧列表中的「预览」按钮来查看 Live2D 模型</p>
                  </div>
                )}
              </div>
            </div>

            {/* Download Card */}
            <div className="rounded-3xl overflow-hidden border border-white/[0.06] bg-gradient-to-br from-blue-600/10 to-violet-600/10 backdrop-blur-sm p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 rounded-2xl bg-blue-500 text-white shadow-lg shadow-blue-600/20">
                  <Download className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">下载队列</h3>
                  <p className="text-slate-500 text-sm">选择一个模型后即可导出 ZIP 文件</p>
                </div>
              </div>

              {selectedCostume && selectedBuildData ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-4 p-5 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
                    <Package className="w-7 h-7 text-blue-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-0.5">Selected</p>
                      <p className="text-xl font-black truncate">{selectedCostume}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 font-black text-lg flex items-center justify-center gap-3 hover:shadow-lg hover:shadow-blue-600/25 disabled:opacity-50 active:scale-[0.98] transition-all"
                  >
                    {isDownloading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Download className="w-6 h-6" />}
                    {isDownloading ? '打包中…' : '立即下载 (.ZIP)'}
                  </button>
                </div>
              ) : (
                <div className="py-12 text-center rounded-2xl border-2 border-dashed border-white/[0.06]">
                  <p className="text-slate-600 font-bold text-sm">尚未选择下载目标</p>
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
