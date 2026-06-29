import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display-webgal/cubism2';
import { CompositeLayerDraft } from '../types';
import {
  createImportCleanedLive2dModelSettings,
  getCompositeExpressionAssets,
  getCompositeMotionAssets,
  prepareCompositeLayers,
} from '../utils/composite';
import { downloadCanvasImage } from '../utils/canvas';
import { Loader2 } from 'lucide-react';

interface CompositeLive2dPreviewProps {
  layers: CompositeLayerDraft[];
  partIdCache: Map<string, string[]>;
  importValue?: number;
  selectedMotion?: string;
  selectedExpression?: string;
}

export interface CompositeLive2dPreviewHandle {
  downloadImage: (fileName?: string) => Promise<void>;
}

(window as any).PIXI = PIXI;

const applyImportToModel = (model: any, importValue?: number) => {
  if (importValue === undefined || !Number.isFinite(importValue)) return;
  model?.internalModel?.coreModel?.setParamFloat?.('PARAM_IMPORT', importValue);
};

const disableAutomaticIdleMotion = (model: any) => {
  const motionManager = model?.internalModel?.motionManager;
  if (!motionManager) return;
  try {
    motionManager.stopAllMotions?.();
  } catch {}
  if (motionManager.groups) {
    motionManager.groups.idle = undefined;
  }
};

const applyMotionToModel = (model: any, name?: string) => {
  if (!name) return;
  try {
    model?.motion?.(name, 0, 3);
  } catch {
    model?.motion?.(name);
  }
};

const applyExpressionToModel = (model: any, name?: string) => {
  if (!name) return;
  model?.expression?.(name);
};

const CompositeLive2dPreview = forwardRef<CompositeLive2dPreviewHandle, CompositeLive2dPreviewProps>(({
  layers,
  partIdCache,
  importValue,
  selectedMotion,
  selectedExpression,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelsRef = useRef<any[]>([]);
  const importValueRef = useRef<number | undefined>(importValue);
  const selectedMotionRef = useRef<string | undefined>(selectedMotion);
  const selectedExpressionRef = useRef<string | undefined>(selectedExpression);
  const destroyedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const layerKey = useMemo(
    () => layers.map((layer) => `${layer.layerId}:${layer.modelName}:${layer.partCategories.join('-')}`).join('|'),
    [layers]
  );
  const motionAssets = useMemo(() => getCompositeMotionAssets(layers), [layers]);
  const expressionAssets = useMemo(() => getCompositeExpressionAssets(layers), [layers]);

  useImperativeHandle(ref, () => ({
    downloadImage: async (fileName = 'model.webp') => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('预览尚未准备好');
      await downloadCanvasImage(canvas, fileName);
    },
  }), []);

  useEffect(() => {
    importValueRef.current = importValue;
    modelsRef.current.forEach((model) => applyImportToModel(model, importValue));
  }, [importValue]);

  useEffect(() => {
    selectedMotionRef.current = selectedMotion;
    modelsRef.current.forEach((model) => applyMotionToModel(model, selectedMotion));
  }, [selectedMotion]);

  useEffect(() => {
    selectedExpressionRef.current = selectedExpression;
    modelsRef.current.forEach((model) => applyExpressionToModel(model, selectedExpression));
  }, [selectedExpression]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || layers.length === 0) return;

    destroyedRef.current = false;
    setLoadError(null);
    setIsLoading(true);

    let app: PIXI.Application | null = null;
    let ro: ResizeObserver | null = null;
    let applyImportTicker: (() => void) | null = null;
    const revokeCleanedModelUrls: Array<() => void> = [];

    const clearModels = () => {
      for (const model of modelsRef.current) {
        try {
          if (model.parent) model.parent.removeChild(model);
          model.destroy();
        } catch {}
      }
      modelsRef.current = [];
    };

    const cleanup = () => {
      ro?.disconnect();
      ro = null;
      if (app && applyImportTicker) {
        try {
          app.ticker.remove(applyImportTicker);
        } catch {}
      }
      applyImportTicker = null;
      clearModels();
      revokeCleanedModelUrls.splice(0).forEach((revoke) => revoke());
      if (app) {
        try {
          app.stage.removeChildren();
        } catch {}
        try {
          app.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {}
        app = null;
        appRef.current = null;
        canvasRef.current = null;
      }
      while (container.firstChild) container.removeChild(container.firstChild);
    };

    const fitModels = () => {
      if (!app || modelsRef.current.length === 0) return;
      const w = app.screen.width;
      const h = app.screen.height;
      const maxModelWidth = Math.max(...modelsRef.current.map((model) => model.width || 1));
      const maxModelHeight = Math.max(...modelsRef.current.map((model) => model.height || 1));
      const scale = Math.min(w / maxModelWidth, h / maxModelHeight) * 0.92;
      const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

      for (const model of modelsRef.current) {
        model.anchor?.set?.(0.5, 0.5);
        model.x = w / 2;
        model.y = h / 2;
        model.scale.set(safeScale);
      }
    };

    const setup = async () => {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!container || destroyedRef.current) {
            resolve();
            return;
          }
          if (container.clientWidth > 0 && container.clientHeight > 0) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
      if (destroyedRef.current) return;

      app = new PIXI.Application({
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundAlpha: 0,
        antialias: true,
        resolution: 1,
        autoDensity: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      appRef.current = app;
      canvasRef.current = app.view as HTMLCanvasElement;
      container.appendChild(canvasRef.current);
      applyImportTicker = () => {
        modelsRef.current.forEach((model) => applyImportToModel(model, importValueRef.current));
      };
      app.ticker.add(applyImportTicker);

      ro = new ResizeObserver(() => {
        if (!app || destroyedRef.current) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w <= 0 || h <= 0) return;
        app.renderer.resize(w, h);
        fitModels();
      });
      ro.observe(container);

      try {
        const prepared = await prepareCompositeLayers(layers, partIdCache);
        for (const layer of prepared) {
          if (destroyedRef.current || !appRef.current) return;
          const { settings, revokeObjectUrls } = await createImportCleanedLive2dModelSettings(
            layer.modelName,
            layer.buildData,
            layer.initOpacities,
            layer.selectorPrefix,
            motionAssets,
            expressionAssets
          );
          if (destroyedRef.current || !appRef.current) {
            revokeObjectUrls();
            return;
          }
          revokeCleanedModelUrls.push(revokeObjectUrls);
          const model = await (Live2DModel as any).from(settings);
          if (destroyedRef.current || !appRef.current) {
            try {
              model.destroy();
            } catch {}
            return;
          }
          try {
            model.autoInteract = false;
            model.interactive = false;
            if ('eventMode' in model) model.eventMode = 'none';
          } catch {}
          disableAutomaticIdleMotion(model);
          applyImportToModel(model, importValueRef.current);
          applyMotionToModel(model, selectedMotionRef.current);
          applyExpressionToModel(model, selectedExpressionRef.current);
          appRef.current.stage.addChild(model);
          modelsRef.current.push(model);
        }
        fitModels();
      } catch (error) {
        console.error('Composite preview failed:', error);
        setLoadError(error instanceof Error ? error.message : '拼好模预览失败');
      } finally {
        if (!destroyedRef.current) setIsLoading(false);
      }
    };

    setup();

    return () => {
      destroyedRef.current = true;
      setIsLoading(false);
      cleanup();
    };
  }, [layerKey, partIdCache, motionAssets, expressionAssets]);

  return (
    <div className="h-full w-full relative">
      <div ref={containerRef} className="h-full w-full" />
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/70 backdrop-blur-sm">
          <Loader2 className="mb-3 h-10 w-10 animate-spin text-emerald-300" />
          <span className="text-xs font-black uppercase tracking-widest text-emerald-300">Loading Composite…</span>
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/75 p-5 text-center text-sm text-slate-100">
          {loadError}
        </div>
      )}
    </div>
  );
});

CompositeLive2dPreview.displayName = 'CompositeLive2dPreview';

export default CompositeLive2dPreview;
