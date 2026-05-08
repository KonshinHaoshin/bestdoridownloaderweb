import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display-webgal/cubism2';
import { BuildData } from '../types';
import { getAssetsBase } from '../config';
import { bundleAssetUrl } from '../utils/assets';

interface Live2dPreviewProps {
  modelName: string;
  buildData: BuildData;
  selectedMotion?: string;
  selectedExpression?: string;
}

export interface Live2dPreviewHandle {
  copyImage: () => Promise<void>;
  downloadImage: (fileName?: string) => Promise<void>;
}

(window as any).PIXI = PIXI;

const motionKey = (fileName: string) => {
  const last = fileName.split('/').pop() || 'idle';
  return last.replace(/\.bytes$/, '').replace(/\.mtn$/, '');
};
const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, '_');
const canLoadImage = (url: string) =>
  new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
const TRANSPARENT_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p7fJ4sAAAAASUVORK5CYII=';

const Live2dPreview = forwardRef<Live2dPreviewHandle, Live2dPreviewProps>(({ modelName, buildData, selectedMotion, selectedExpression }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const live2dRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const destroyedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    copyImage: async () => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('预览尚未准备好');
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器不支持复制图片');
      }
      const blob = await canvasToPngBlob(canvas);
      if (!blob) throw new Error('导出图片失败');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    },
    downloadImage: async (fileName = `${modelName}.png`) => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('预览尚未准备好');
      const blob = await canvasToPngBlob(canvas);
      if (!blob) throw new Error('导出图片失败');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safeFileName(fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    destroyedRef.current = false;
    setLoadError(null);

    let app: PIXI.Application | null = null;
    let ro: ResizeObserver | null = null;

    const cleanup = () => {
      ro?.disconnect();
      ro = null;
      if (app) {
        try {
          app.stage.removeChildren();
        } catch {}
        try {
          app.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {}
        app = null;
        appRef.current = null;
        live2dRef.current = null;
        canvasRef.current = null;
      }
      while (container.firstChild) container.removeChild(container.firstChild);
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
      const resize = () => {
        if (!app || destroyedRef.current) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w <= 0 || h <= 0) return;
        app.renderer.resize(w, h);
        if (live2dRef.current) {
          live2dRef.current.x = app.screen.width / 2;
          live2dRef.current.y = app.screen.height / 2;
          const mw = live2dRef.current.width || 1;
          const mh = live2dRef.current.height || 1;
          const s = Math.min(app.screen.width / mw, app.screen.height / mh) * 0.95;
          live2dRef.current.scale.set(Number.isFinite(s) && s > 0 ? s : 1);
        }
      };
      ro = new ResizeObserver(resize);
      ro.observe(container);

      if (destroyedRef.current) {
        cleanup();
        return;
      }

      try {
        const modelUrl = bundleAssetUrl(buildData.model, 'model');
        const physicsUrl = bundleAssetUrl(buildData.physics, 'physics');
        const textureUrls = buildData.textures.map((t) => bundleAssetUrl(t, 'texture'));

        // Probe texture URLs to expose the exact failing file in console.
        const textureChecks = await Promise.all(textureUrls.map((u) => canLoadImage(u)));
        if (!textureChecks.every(Boolean)) {
          const failed = textureUrls.filter((_, i) => !textureChecks[i]);
          const msg = `模型贴图缺失或返回非图片资源：${failed.join(', ')}`;
          console.error(msg);
          setLoadError(msg);
          return;
        }
        const firstValidTexture = textureUrls[textureChecks.findIndex(Boolean)] || TRANSPARENT_PNG_DATA_URL;
        const resolvedTextureUrls = textureUrls.map((u, i) => {
          if (textureChecks[i]) return u;
          console.error('Texture probe failed:', u);
          console.warn('Texture fallback applied:', u, '->', firstValidTexture);
          return firstValidTexture;
        });

        const modelSettings: any = {
          // Keep a URL base even though entries are absolute paths.
          url: `${getAssetsBase()}/jp/live2d/chara/${modelName}_rip/buildData.asset`,
          // Remote preview serves moc/mtn as extensionless files.
          model: modelUrl,
          textures: resolvedTextureUrls,
          physics: physicsUrl,
          motions: buildData.motions.reduce((acc: any, m) => {
            const key = motionKey(m.fileName) || 'idle';
            acc[key] = [{ file: bundleAssetUrl(m, 'motion') }];
            return acc;
          }, {}),
          expressions: buildData.expressions.map((e) => ({
            name: e.fileName.replace(/\.exp\.json$/, ''),
            file: bundleAssetUrl(e, 'expression'),
          })),
        };

        const live2d = await (Live2DModel as any).from(modelSettings);
        // The WebGAL fork still expects renderer.plugins.interaction.on/off,
        // which is incompatible with current Pixi v7 runtime in this project.
        // Disable built-in interaction to prevent render-time crash.
        try {
          live2d.autoInteract = false;
          live2d.interactive = false;
          if ('eventMode' in live2d) live2d.eventMode = 'none';
        } catch {}
        live2dRef.current = live2d;

        if (destroyedRef.current || !appRef.current) return;

        app.stage.addChild(live2d);

        live2d.anchor.set(0.5, 0.5);
        live2d.x = app.screen.width / 2;
        live2d.y = app.screen.height / 2;

        const w = live2d.width || 1;
        const h = live2d.height || 1;
        const s = Math.min(app.screen.width / w, app.screen.height / h) * 0.95;
        live2d.scale.set(Number.isFinite(s) && s > 0 ? s : 1);

        // Keep idle motion by default; tap/hit interaction is disabled by compatibility workaround.
        try {
          live2d.motion(selectedMotion || 'idle');
        } catch {}
      } catch (err) {
        console.error('Live2D load error:', err);
        setLoadError(err instanceof Error ? err.message : '模型加载失败');
      }
    };

    setup();

    return () => {
      destroyedRef.current = true;
      cleanup();
    };
  }, [modelName, buildData]);

  useEffect(() => {
    if (!selectedMotion || !live2dRef.current) return;
    live2dRef.current.motion(selectedMotion).catch(() => {});
  }, [selectedMotion]);

  useEffect(() => {
    if (!selectedExpression || !live2dRef.current) return;
    live2dRef.current.expression(selectedExpression).catch(() => {});
  }, [selectedExpression]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" />
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70 text-slate-100 text-sm p-4 text-center">
          {loadError}
        </div>
      )}
    </div>
  );
});

Live2dPreview.displayName = 'Live2dPreview';

export default Live2dPreview;
