import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import type { ThemeAssets } from '../../types/theme';

interface ImageUploaderProps {
  assets: ThemeAssets;
  onAssetsChange: (assets: ThemeAssets) => void;
  uploadType?: 'logo' | 'background' | 'favicon';
  currentUrl?: string | null;
  label?: string;
  description?: string;
  maxSizeMB?: number;
}

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'];

export default function ImageUploader({
  assets,
  onAssetsChange,
  uploadType = 'logo',
  currentUrl,
  label = 'Upload Image',
  description = 'Drag and drop an image or click to browse',
  maxSizeMB = 5,
}: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      return `Invalid file type. Accepted: ${ACCEPTED_IMAGE_TYPES.map(t => t.split('/')[1].toUpperCase()).join(', ')}`;
    }
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return `File too large. Maximum size: ${maxSizeMB}MB`;
    }
    return null;
  };

  const processFile = (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsUploading(true);

    // Create a local preview URL for immediate feedback
    const localPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(localPreviewUrl);

    // Simulate upload and update assets
    // In production, this would call the uploadThemeAsset API
    setTimeout(() => {
      // For demo purposes, store the data URL
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        // Only ever render an image data URL — guards against the FileReader
        // result being interpreted as anything but an image (CodeQL
        // js/xss-through-dom).
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
          setPreviewUrl(dataUrl);
        }
        setIsUploading(false);

        // Update assets based on upload type
        const updatedAssets = { ...assets };
        switch (uploadType) {
          case 'logo':
            updatedAssets.logoUrl = dataUrl;
            updatedAssets.logoAlt = file.name.replace(/\.[^/.]+$/, '');
            break;
          case 'background':
            updatedAssets.backgroundImageUrl = dataUrl;
            break;
          case 'favicon':
            updatedAssets.faviconUrl = dataUrl;
            break;
        }
        onAssetsChange(updatedAssets);
      };
      reader.readAsDataURL(file);
    }, 500);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = () => {
    setPreviewUrl(null);
    setError(null);

    const updatedAssets = { ...assets };
    switch (uploadType) {
      case 'logo':
        updatedAssets.logoUrl = null;
        updatedAssets.logoAlt = null;
        break;
      case 'background':
        updatedAssets.backgroundImageUrl = null;
        break;
      case 'favicon':
        updatedAssets.faviconUrl = null;
        break;
    }
    onAssetsChange(updatedAssets);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label className="text-sm font-medium text-gray-700">{label}</label>
      )}

      {/* Upload Zone */}
      <div
        data-testid={`image-uploader-${uploadType}`}
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-all cursor-pointer
          ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'}
          ${previewUrl ? 'border-solid border-indigo-200 bg-indigo-50/50' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          onChange={handleFileSelect}
          className="hidden"
          data-testid={`image-uploader-input-${uploadType}`}
        />

        {isUploading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <p className="text-sm text-gray-500">Uploading...</p>
          </div>
        ) : previewUrl ? (
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <img
                src={previewUrl}
                alt="Preview"
                className="max-h-32 max-w-full rounded-lg object-contain"
                data-testid={`image-uploader-preview-${uploadType}`}
              />
            </div>
            <p className="text-xs text-gray-500">Click or drop to replace</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <svg
              className="h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">{description}</p>
              <p className="text-xs text-gray-500 mt-1">
                PNG, JPG, GIF, SVG, WebP (max {maxSizeMB}MB)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-sm text-red-600" data-testid={`image-uploader-error-${uploadType}`}>
          {error}
        </p>
      )}

      {/* Remove Button */}
      {previewUrl && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          className="text-sm text-red-600 hover:text-red-800"
          data-testid={`image-uploader-remove-${uploadType}`}
        >
          Remove image
        </button>
      )}
    </div>
  );
}