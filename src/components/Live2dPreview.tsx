import { useEffect, useRef, FC } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism2';
import { BuildData } from '../types';

interface Live2dPreviewProps {
  modelName: string;
  buildData: BuildData;
}

(window as any).PIXI = PIXI;

const motionKey = (fileName: string) => {
  const last = fileName.split('/').pop() || 'idle';
  return last.replace(/\.bytes$/, '').replace(/\.mtn$/, '');
};
const removeBytesSuffix = (s: string) => s.replace(/\.bytes$/, '');
const normalizeTextureFile = (s: string) => {
  if (s.endsWith('.bytes')) return s.replace(/\.bytes$/, '.png');
  return s.includes('.') ? s : `${s}.png`;
};
const toAbs = (baseUrl: string, fileName: string) => new URL(fileName, baseUrl).toString();
const canLoadImage = (url: string) =>
  new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
const TRANSPARENT_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p7fJ4sAAAAASUVORK5CYII=';

const Live2dPreview: FC<Live2dPreviewProps> = ({ modelName, buildData }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const destroyedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    destroyedRef.current = false;

    let app: PIXI.Application | null = null;

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
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      appRef.current = app;
      container.appendChild(app.view as HTMLCanvasElement);
      (app.view as HTMLCanvasElement).style.width = '100%';
      (app.view as HTMLCanvasElement).style.height = '100%';

      if (destroyedRef.current) {
        cleanup();
        return;
      }

      try {
        const basePath = `/bestdori-assets/jp/live2d/chara/${modelName}_rip/`;
        const baseUrl = `${window.location.origin}${basePath}`;
        const modelUrl = toAbs(baseUrl, removeBytesSuffix(buildData.model.fileName));
        const physicsUrl = toAbs(baseUrl, buildData.physics.fileName);
        const textureUrls = buildData.textures.map((t) => toAbs(baseUrl, normalizeTextureFile(t.fileName)));

        // Probe texture URLs to expose the exact failing file in console.
        const textureChecks = await Promise.all(textureUrls.map((u) => canLoadImage(u)));
        const firstValidTexture = textureUrls[textureChecks.findIndex(Boolean)] || TRANSPARENT_PNG_DATA_URL;
        const resolvedTextureUrls = textureUrls.map((u, i) => {
          if (textureChecks[i]) return u;
          console.error('Texture probe failed:', u);
          console.warn('Texture fallback applied:', u, '->', firstValidTexture);
          return firstValidTexture;
        });

        const modelSettings: any = {
          // Used as base URL for resolving relative files.
          url: `${baseUrl}buildData.asset`,
          // Remote preview serves moc/mtn as extensionless files.
          model: modelUrl,
          textures: resolvedTextureUrls,
          physics: physicsUrl,
          motions: buildData.motions.reduce((acc: any, m) => {
            const key = motionKey(m.fileName) || 'idle';
            acc[key] = [{ file: toAbs(baseUrl, removeBytesSuffix(m.fileName)) }];
            return acc;
          }, {}),
          // Bestdori expression files are inconsistent across costumes; skip to keep preview stable.
          expressions: [],
        };

        const live2d = await (Live2DModel as any).from(modelSettings);

        if (destroyedRef.current || !appRef.current) return;

        app.stage.addChild(live2d);

        live2d.anchor.set(0.5, 0.5);
        live2d.x = app.screen.width / 2;
        live2d.y = app.screen.height / 2;

        const w = live2d.width || 1;
        const h = live2d.height || 1;
        const s = Math.min(app.screen.width / w, app.screen.height / h) * 0.85;
        live2d.scale.set(Number.isFinite(s) && s > 0 ? s : 1);

        live2d.on('hit', (areas: string[]) => {
          if (areas.includes('body')) live2d.motion('tap_body');
          if (areas.includes('head')) live2d.motion('idle');
        });
      } catch (err) {
        console.error('Live2D load error:', err);
      }
    };

    const cleanup = () => {
      if (app) {
        try {
          app.stage.removeChildren();
        } catch {}
        try {
          app.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {}
        app = null;
        appRef.current = null;
      }
      while (container.firstChild) container.removeChild(container.firstChild);
    };

    setup();

    return () => {
      destroyedRef.current = true;
      cleanup();
    };
  }, [modelName, buildData]);

  return <div ref={containerRef} className="w-full h-full" />;
};

export default Live2dPreview;
