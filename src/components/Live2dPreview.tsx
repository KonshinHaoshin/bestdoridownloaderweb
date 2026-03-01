import { useEffect, useRef, FC } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism2';
import { BuildData } from '../types';

interface Live2dPreviewProps {
  modelName: string;
  buildData: BuildData;
}

(window as any).PIXI = PIXI;

const Live2dPreview: FC<Live2dPreviewProps> = ({ modelName, buildData }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const destroyedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    destroyedRef.current = false;

    const waitForSize = () =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });

    const setup = async () => {
      await waitForSize();
      if (destroyedRef.current) return;

      const canvas = document.createElement('canvas');
      container.appendChild(canvas);

      const app = new PIXI.Application({
        view: canvas,
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        powerPreference: 'high-performance',
      });
      appRef.current = app;

      if (destroyedRef.current) {
        app.destroy(true, { children: true });
        return;
      }

      try {
        const baseUrl = `/bestdori-assets/jp/live2d/chara/${modelName}_rip/`;

        const modelSettings: any = {
          url: `${window.location.origin}${baseUrl}model.json`,
          model: buildData.model.fileName.replace(/\.bytes$/, ''),
          textures: buildData.textures.map((t) =>
            t.fileName.includes('.') ? t.fileName : `${t.fileName}.png`
          ),
          physics: buildData.physics.fileName,
          motions: buildData.motions.reduce((acc: any, m) => {
            const raw = m.fileName.replace(/\.bytes$/, '');
            const name = raw.split('/').pop()?.replace(/\.mtn$/, '') || 'idle';
            acc[name] = [{ file: raw }];
            return acc;
          }, {}),
          expressions: buildData.expressions.map((e) => ({
            name: e.fileName.replace(/\.exp\.json$/, ''),
            file: e.fileName,
          })),
        };

        const live2d = await (Live2DModel as any).from(modelSettings);

        if (destroyedRef.current || !appRef.current) return;

        app.stage.addChild(live2d);

        live2d.anchor.set(0.5, 0.5);
        live2d.x = app.screen.width / 2;
        live2d.y = app.screen.height / 2;

        const s = Math.min(
          app.screen.width / live2d.width,
          app.screen.height / live2d.height
        ) * 0.85;
        live2d.scale.set(s);

        live2d.on('hit', (areas: string[]) => {
          if (areas.includes('body')) live2d.motion('tap_body');
          if (areas.includes('head')) live2d.expression();
        });
      } catch (err) {
        console.error('Live2D load error:', err);
      }
    };

    setup();

    return () => {
      destroyedRef.current = true;
      if (appRef.current) {
        // Manually remove all children before destroying to avoid
        // pixi-live2d-display crash on InteractionManager.off
        try {
          appRef.current.stage.removeChildren();
        } catch {}
        try {
          appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {}
        appRef.current = null;
      }
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  }, [modelName, buildData]);

  return <div ref={containerRef} className="w-full h-full" />;
};

export default Live2dPreview;
