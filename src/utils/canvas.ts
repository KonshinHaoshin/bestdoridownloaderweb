export const canvasToImageBlob = (canvas: HTMLCanvasElement, type = 'image/png') =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));

export const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, '_');

export const downloadCanvasImage = async (
  canvas: HTMLCanvasElement,
  fileName: string,
  type = 'image/webp'
) => {
  const blob = await canvasToImageBlob(canvas, type);
  if (!blob) throw new Error('导出图片失败');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
