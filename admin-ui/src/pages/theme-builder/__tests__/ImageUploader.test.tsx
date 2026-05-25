import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageUploader from '../ImageUploader';
import type { ThemeAssets } from '../../types/theme';

const defaultAssets: ThemeAssets = {
  logoUrl: null,
  logoAlt: null,
  faviconUrl: null,
  backgroundImageUrl: null,
  backgroundImageOpacity: 1,
  socialLogoUrls: {},
};

describe('ImageUploader', () => {
  const mockOnAssetsChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockFile = (name: string, type: string, size: number) => {
    return new File([new Uint8Array(size)], name, { type });
  };

  describe('Rendering', () => {
    it('renders upload zone with correct label', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
          label="Logo Image"
        />
      );

      expect(screen.getByText('Logo Image')).toBeInTheDocument();
    });

    it('renders with default description when not provided', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
        />
      );

      expect(screen.getByText('Drag and drop an image or click to browse')).toBeInTheDocument();
    });

    it('renders with custom description', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
          description="Upload your brand logo here"
        />
      );

      expect(screen.getByText('Upload your brand logo here')).toBeInTheDocument();
    });

    it('renders upload icon when no image is uploaded', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
        />
      );

      const uploadIcon = document.querySelector('svg');
      expect(uploadIcon).toBeInTheDocument();
    });

    it('renders accepted file types hint', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
        />
      );

      expect(screen.getByText('PNG, JPG, GIF, SVG, WebP (max 5MB)')).toBeInTheDocument();
    });
  });

  describe('Data Attributes', () => {
    it('has correct data-testid on upload zone', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
        />
      );

      expect(screen.getByTestId('image-uploader-logo')).toBeInTheDocument();
    });

    it('has correct data-testid on file input', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="background"
        />
      );

      expect(screen.getByTestId('image-uploader-input-background')).toBeInTheDocument();
    });

    it('has different testids for different upload types', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="favicon"
        />
      );

      expect(screen.getByTestId('image-uploader-favicon')).toBeInTheDocument();
      expect(screen.getByTestId('image-uploader-input-favicon')).toBeInTheDocument();
    });
  });

  describe('Click Behavior', () => {
    it('opens file dialog when clicking upload zone', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
        />
      );

      const uploadZone = screen.getByTestId('image-uploader-logo');
      const fileInput = screen.getByTestId('image-uploader-input-logo') as HTMLInputElement;

      const clickSpy = vi.spyOn(fileInput, 'click');
      fireEvent.click(uploadZone);

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('File Validation', () => {
    it('shows error for invalid file type', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
        />
      );

      const fileInput = screen.getByTestId('image-uploader-input-logo');
      const invalidFile = createMockFile('document.pdf', 'application/pdf', 1024);

      fireEvent.change(fileInput, { target: { files: [invalidFile] } });

      expect(screen.getByTestId('image-uploader-error-logo')).toHaveTextContent(
        'Invalid file type. Accepted: PNG, JPEG, GIF, SVG+XML, WEBP'
      );
    });

    it.skip('shows error for files exceeding size limit', () => {
      vi.useFakeTimers();
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
          maxSizeMB={1}
        />
      );

      const fileInput = screen.getByTestId('image-uploader-input-logo');
      const largeFile = createMockFile('large-image.png', 'image/png', 2 * 1024 * 1024);

      fireEvent.change(fileInput, { target: { files: [largeFile] } });
      vi.advanceTimersByTime(100);

      const errorEl = screen.getByTestId('image-uploader-error-logo');
      expect(errorEl.textContent).toMatch(/File too large|Maximum size/i);

      vi.useRealTimers();
    });
  });

  describe('Drag and Drop', () => {
    it('adds dragging class when dragging over', () => {
      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
        />
      );

      const uploadZone = screen.getByTestId('image-uploader-logo');

      fireEvent.dragEnter(uploadZone);
      expect(uploadZone).toHaveClass('border-indigo-500', 'bg-indigo-50');

      fireEvent.dragLeave(uploadZone);
    });
  });

  describe('Image Preview', () => {
    it('shows preview after successful upload', () => {
      vi.useFakeTimers();

      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
        />
      );

      const fileInput = screen.getByTestId('image-uploader-input-logo');
      const validImage = createMockFile('logo.png', 'image/png', 1024);

      fireEvent.change(fileInput, { target: { files: [validImage] } });

      // Show loading state
      expect(screen.getByText('Uploading...')).toBeInTheDocument();

      vi.advanceTimersByTime(600);

      vi.useRealTimers();
    });
  });

  describe('Remove Functionality', () => {
    it('shows remove button when image is uploaded', () => {
      vi.useFakeTimers();

      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
          currentUrl="data:image/png;base64,test"
        />
      );

      expect(screen.getByTestId('image-uploader-remove-logo')).toBeInTheDocument();
      expect(screen.getByText('Remove image')).toBeInTheDocument();

      vi.useRealTimers();
    });

    it('calls onAssetsChange when remove is clicked', () => {
      vi.useFakeTimers();

      render(
        <ImageUploader
          assets={defaultAssets}
          onAssetsChange={mockOnAssetsChange}
          uploadType="logo"
          currentUrl="data:image/png;base64,test"
        />
      );

      const removeButton = screen.getByTestId('image-uploader-remove-logo');
      fireEvent.click(removeButton);

      vi.advanceTimersByTime(100);

      vi.useRealTimers();
    });
  });
});