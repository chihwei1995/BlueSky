const DEFAULT_OPTIONS = {
  maxWidth: 1200,
  maxHeight: 1200,
  maxBytes: 500 * 1024,
  mimeType: "image/webp",
  quality: 0.74,
  minQuality: 0.46,
  qualityStep: 0.06,
  minWidth: 720,
  minHeight: 720,
  resizeStep: 0.85
};

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const loadImageBitmap = async (file) => {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const blobToFile = (blob, fileName) => {
  return new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now()
  });
};

const renameWithMime = (name, mimeType) => {
  const extension = EXTENSIONS[mimeType] || "webp";
  const baseName = String(name || "upload")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "upload";
  return `${baseName}.${extension}`;
};

const canvasToBlob = (canvas, mimeType, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
      return;
    }
    reject(new Error("canvas-to-blob-failed"));
  }, mimeType, quality);
});

const renderToCanvas = (source, width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
};

const compressCanvas = async (canvas, settings) => {
  let quality = settings.quality;
  let bestBlob = await canvasToBlob(canvas, settings.mimeType, quality);

  while (bestBlob.size > settings.maxBytes && quality > settings.minQuality) {
    quality = Math.max(settings.minQuality, quality - settings.qualityStep);
    bestBlob = await canvasToBlob(canvas, settings.mimeType, quality);
    if (quality === settings.minQuality) break;
  }

  return bestBlob;
};

export const compressImageUpload = async (file, options = {}) => {
  if (!(file instanceof File) || !String(file.type || "").startsWith("image/")) {
    return file;
  }

  const settings = { ...DEFAULT_OPTIONS, ...options };

  try {
    const source = await loadImageBitmap(file);
    const width = source.width || source.naturalWidth || 0;
    const height = source.height || source.naturalHeight || 0;
    if (!width || !height) return file;

    const ratio = Math.min(
      1,
      settings.maxWidth / width,
      settings.maxHeight / height
    );
    let targetWidth = Math.max(1, Math.round(width * ratio));
    let targetHeight = Math.max(1, Math.round(height * ratio));
    let canvas = renderToCanvas(source, targetWidth, targetHeight);
    if (!canvas) return file;

    let bestBlob = await compressCanvas(canvas, settings);

    while (
      bestBlob.size > settings.maxBytes &&
      targetWidth > settings.minWidth &&
      targetHeight > settings.minHeight
    ) {
      targetWidth = Math.max(settings.minWidth, Math.round(targetWidth * settings.resizeStep));
      targetHeight = Math.max(settings.minHeight, Math.round(targetHeight * settings.resizeStep));
      canvas = renderToCanvas(source, targetWidth, targetHeight);
      if (!canvas) break;
      bestBlob = await compressCanvas(canvas, settings);
      if (targetWidth === settings.minWidth || targetHeight === settings.minHeight) {
        break;
      }
    }

    if (typeof source.close === "function") source.close();

    return blobToFile(bestBlob, renameWithMime(file.name, bestBlob.type || settings.mimeType));
  } catch (error) {
    console.warn("Image compression skipped:", error);
    return file;
  }
};
