import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type {
  ThemeStyles,
  ThemeComponent,
  ThemeAssets,
  ThemeSettings,
  ThemeVersion,
  ThemeComponent as DraggableComponent,
} from '../../types/theme';
import {
  DEFAULT_THEME_STYLES,
  DEFAULT_THEME_COMPONENTS,
  DEFAULT_THEME_ASSETS,
  DEFAULT_THEME_SETTINGS,
} from '../../types/theme';
import { rollbackTheme, updateTheme, publishTheme } from '../../api/themes';
import ComponentPalette from './ComponentPalette';
import ThemeCanvas from './ThemeCanvas';
import LivePreview from './LivePreview';
import StyleEditor from './StyleEditor';
import ImageUploader from './ImageUploader';
import ThemeTemplates from './ThemeTemplates';
import ThemeVersionHistory from './ThemeVersionHistory';

// ─── Viewport type ─────────────────────────────────────────────────────────────

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

// ─── Layout sections ──────────────────────────────────────────────────────────

type LayoutSection = 'canvas' | 'preview';

// ─── Editor panel type ────────────────────────────────────────────────────────

type EditorPanel = 'palette' | 'canvas' | 'styles' | 'assets' | 'templates' | 'history';

// ─── Component ────────────────────────────────────────────────────────────────

export default function ThemeBuilderPage() {
  const { name: realmName } = useParams<{ name: string }>();

  // ── Theme state (shared across all sections) ──────────────────────────────

  const [styles, setStyles] = useState<ThemeStyles>(DEFAULT_THEME_STYLES);
  const [components, setComponents] = useState<ThemeComponent[]>(DEFAULT_THEME_COMPONENTS);
  const [assets, setAssets] = useState<ThemeAssets>(DEFAULT_THEME_ASSETS);
  const [settings, setSettings] = useState<ThemeSettings>(DEFAULT_THEME_SETTINGS);

  // ── UI state ─────────────────────────────────────────────────────────────

  const [viewportSize, setViewportSize] = useState<ViewportSize>('desktop');
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<LayoutSection>('canvas');
  const [editorPanel, setEditorPanel] = useState<EditorPanel>('canvas');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Placeholder theme state (would come from API in real implementation)
  const [themeId] = useState<string>('demo-theme-id');
  const [currentVersion, setCurrentVersion] = useState<number>(1);

  // ── Rollback notification state ────────────────────────────────────────────

  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackSuccess, setRollbackSuccess] = useState<string | null>(null);

  // ── Auto-save state ─────────────────────────────────────────────────────────

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs to track latest values for use in effect
  const themeStateRef = useRef({ styles, components, assets, settings });

  // Update ref when state changes
  useEffect(() => {
    themeStateRef.current = { styles, components, assets, settings };
  }, [styles, components, assets, settings]);

  // ── Save handler ────────────────────────────────────────────────────────────

  const handleSave = useCallback(async (reason: 'manual' | 'auto-save' = 'manual') => {
    if (isSaving) return;
    if (!themeId) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const currentState = themeStateRef.current;
      await updateTheme(realmName || '', themeId, {
        styles: currentState.styles,
        components: currentState.components,
        assets: currentState.assets,
        settings: currentState.settings,
      });
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save changes';
      setSaveError(message);
      // Don't throw - auto-save failures shouldn't break the editor
      if (reason === 'manual') {
        throw err;
      }
    } finally {
      setIsSaving(false);
    }
  }, [realmName, themeId, isSaving]);

  // Ref to track the latest handleSave for use in effect
  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  // ── Auto-save effect ────────────────────────────────────────────────────────

  useEffect(() => {
    // Track changes by comparing with ref values
    const prev = themeStateRef.current;
    const hasChanges =
      prev.styles !== styles ||
      prev.components !== components ||
      prev.assets !== assets ||
      prev.settings !== settings;

    if (hasChanges) {
      setHasUnsavedChanges(true);

      // Clear existing timeout
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // Set new auto-save timeout (5 seconds of inactivity)
      autoSaveTimeoutRef.current = setTimeout(() => {
        handleSaveRef.current('auto-save');
      }, 5000);
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [styles, components, assets, settings]);

  // ── Publish handler ─────────────────────────────────────────────────────────

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  const handlePublish = useCallback(async () => {
    if (isPublishing) return;
    if (!themeId) return;

    setIsPublishing(true);
    setSaveError(null);
    setPublishSuccess(null);

    try {
      // First save any pending changes
      await handleSave('manual');

      // Then publish
      const result = await publishTheme(realmName || '', themeId);

      // Update version number from published result
      if (result.version) {
        setCurrentVersion(result.version);
      }

      setPublishSuccess(`Published version ${result.version}`);
      setTimeout(() => setPublishSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish theme';
      setSaveError(message);
      throw err;
    } finally {
      setIsPublishing(false);
    }
  }, [realmName, themeId, isPublishing, handleSave]);

  // ── Rollback handler ─────────────────────────────────────────────────────

  const handleRollback = useCallback(async (version: ThemeVersion) => {
    setRollbackError(null);
    setRollbackSuccess(null);

    try {
      const updatedTheme = await rollbackTheme(realmName || '', themeId, version.id);
      // Update theme state with the rolled-back data
      if (updatedTheme.styles) {
        setStyles(updatedTheme.styles);
      }
      if (updatedTheme.components) {
        setComponents(updatedTheme.components);
      }
      if (updatedTheme.assets) {
        setAssets((prev) => ({ ...prev, ...updatedTheme.assets }));
      }
      if (updatedTheme.settings) {
        setSettings((prev) => ({ ...prev, ...updatedTheme.settings }));
      }
      // Update current version
      if (updatedTheme.version) {
        setCurrentVersion(updatedTheme.version);
      }
      setRollbackSuccess(`Successfully restored to version ${version.version}`);
      // Clear success message after 3 seconds
      setTimeout(() => setRollbackSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restore version';
      setRollbackError(message);
      throw err; // Re-throw so ThemeVersionHistory can handle the loading state
    }
  }, [realmName, themeId]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleViewportChange = useCallback((size: ViewportSize) => {
    setViewportSize(size);
  }, []);

  const handleComponentsChange = useCallback((updated: ThemeComponent[]) => {
    setComponents(updated);
  }, []);

  const handleSelectComponent = useCallback((component: DraggableComponent | null) => {
    setSelectedComponentId(component?.id ?? null);
  }, []);

  const handleStylesChange = useCallback((updated: ThemeStyles) => {
    setStyles(updated);
  }, []);

  const handleAssetsChange = useCallback((updated: ThemeAssets) => {
    setAssets(updated);
  }, []);

  const handleApplyTemplate = useCallback((template: {
    styles: ThemeStyles;
    components: ThemeComponent[];
    assets: Partial<ThemeAssets>;
    settings: Partial<ThemeSettings>;
  }) => {
    setStyles(template.styles);
    setComponents(template.components);
    if (template.assets.logoUrl !== undefined) {
      setAssets((prev) => ({ ...prev, logoUrl: template.assets.logoUrl ?? null }));
    }
    if (template.assets.backgroundImageUrl !== undefined) {
      setAssets((prev) => ({ ...prev, backgroundImageUrl: template.assets.backgroundImageUrl ?? null }));
    }
    if (template.assets.faviconUrl !== undefined) {
      setAssets((prev) => ({ ...prev, faviconUrl: template.assets.faviconUrl ?? null }));
    }
    setSettings((prev) => ({ ...prev, ...template.settings }));
  }, []);

  // ── Import/Export handlers ──────────────────────────────────────────────

  interface ThemeExportData {
    version: string;
    realmName?: string;
    exportedAt?: string;
    styles: ThemeStyles;
    components: ThemeComponent[];
    assets: ThemeAssets;
    settings: ThemeSettings;
  }

  const validateImportData = useCallback((data: unknown): data is ThemeExportData => {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (!obj.styles || typeof obj.styles !== 'object') return false;
    if (!Array.isArray(obj.components)) return false;
    if (!obj.assets || typeof obj.assets !== 'object') return false;
    if (!obj.settings || typeof obj.settings !== 'object') return false;
    return true;
  }, []);

  const handleImportTheme = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);

        if (!validateImportData(parsed)) {
          setImportError('Invalid theme file: missing required fields (styles, components, assets, settings)');
          return;
        }

        setStyles(parsed.styles);
        setComponents(parsed.components);
        setAssets(parsed.assets);
        setSettings(parsed.settings);
      } catch {
        setImportError('Invalid JSON file: could not parse the file');
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read file');
    };
    reader.readAsText(file);

    // Reset the input so the same file can be selected again
    event.target.value = '';
  }, [validateImportData]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Theme Builder</h1>
          <span className="rounded bg-gray-100 px-2 py-1 text-sm text-gray-600">
            Realm: {realmName}
          </span>
          {lastSaved && (
            <span className="text-xs text-gray-400">
              {hasUnsavedChanges ? 'Unsaved changes' : `Saved ${lastSaved.toLocaleTimeString()}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportTheme}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Import Theme
          </button>
          {importError && (
            <span className="rounded bg-red-50 px-2 py-1 text-sm text-red-600">
              {importError}
            </span>
          )}
          <button
            onClick={() => {
              const exportData = {
                version: '1.0',
                realmName,
                exportedAt: new Date().toISOString(),
                styles,
                components,
                assets,
                settings,
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${realmName}-theme-export.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export Theme
          </button>
          {/* Save button */}
          <button
            onClick={() => handleSave('manual')}
            disabled={isSaving || !hasUnsavedChanges}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? (
              <span className="flex items-center gap-1.5">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
                Saving...
              </span>
            ) : (
              'Save'
            )}
          </button>
          {/* Publish button */}
          <button
            onClick={handlePublish}
            disabled={isPublishing || isSaving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPublishing ? (
              <span className="flex items-center gap-1.5">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Publishing...
              </span>
            ) : (
              'Publish'
            )}
          </button>
          {/* Success/Error messages */}
          {saveError && (
            <span className="rounded bg-red-50 px-2 py-1 text-sm text-red-600">
              {saveError}
            </span>
          )}
          {publishSuccess && (
            <span className="rounded bg-green-50 px-2 py-1 text-sm text-green-600">
              {publishSuccess}
            </span>
          )}
          <button
            onClick={() => setActiveSection('canvas')}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              activeSection === 'canvas'
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setActiveSection('preview')}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              activeSection === 'preview'
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Preview Only
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Component palette */}
        <div className="w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-4">
          <ComponentPalette onAddComponent={(type) => {
            // When adding from palette, create a new component and add to state
            const id = `${type}-${Date.now()}`;
            const newComponent: ThemeComponent = {
              id,
              type,
              label: type.charAt(0).toUpperCase() + type.slice(1),
              order: components.length,
              visible: true,
              props: {},
            };
            setComponents((prev) => [...prev, newComponent]);
          }} />
        </div>

        {/* Middle: Canvas or Live Preview */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Section tabs */}
          <div className="flex border-b border-gray-200 bg-white px-4">
            <button
              onClick={() => setActiveSection('canvas')}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeSection === 'canvas'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Canvas
            </button>
            <button
              onClick={() => setActiveSection('preview')}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeSection === 'preview'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Preview
            </button>
          </div>

          {/* Content */}
          <div className="flex flex-1 overflow-hidden">
            {activeSection === 'canvas' ? (
              <div className="flex flex-1">
                {/* Canvas area */}
                <div className="flex flex-1 flex-col">
                  <ThemeCanvas
                    components={components}
                    onChange={handleComponentsChange}
                    onSelectComponent={handleSelectComponent}
                    selectedComponentId={selectedComponentId}
                  />
                </div>
              </div>
            ) : (
              <LivePreview
                styles={styles}
                components={components}
                assets={assets}
                settings={settings}
                viewportSize={viewportSize}
                onViewportChange={handleViewportChange}
              />
            )}
          </div>
        </div>

        {/* Right: Live Preview or Style Editor (always visible when in canvas mode) */}
        {activeSection === 'canvas' && (
          <div className="w-[450px] shrink-0 flex flex-col border-l border-gray-200">
            {/* Panel tabs */}
            <div className="flex border-b border-gray-200 bg-white">
              <button
                onClick={() => setEditorPanel('canvas')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  editorPanel === 'canvas'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => setEditorPanel('styles')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  editorPanel === 'styles'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Styles
              </button>
              <button
                onClick={() => setEditorPanel('assets')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  editorPanel === 'assets'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Assets
              </button>
              <button
                onClick={() => setEditorPanel('templates')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  editorPanel === 'templates'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Templates
              </button>
              <button
                onClick={() => setEditorPanel('history')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  editorPanel === 'history'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                History
              </button>
            </div>
            {editorPanel === 'canvas' ? (
              <LivePreview
                styles={styles}
                components={components}
                assets={assets}
                settings={settings}
                viewportSize={viewportSize}
                onViewportChange={handleViewportChange}
              />
            ) : editorPanel === 'styles' ? (
              <StyleEditor
                styles={styles}
                assets={assets}
                onChange={handleStylesChange}
                onAssetsChange={handleAssetsChange}
              />
            ) : editorPanel === 'templates' ? (
              <ThemeTemplates
                onApplyTemplate={handleApplyTemplate}
                currentTemplateId={null}
              />
            ) : editorPanel === 'history' ? (
              <div className="flex flex-col h-full">
                <ThemeVersionHistory
                  themeId={themeId}
                  realmName={realmName || ''}
                  currentVersion={currentVersion}
                  onRollback={handleRollback}
                />
                {/* Rollback notifications */}
                {rollbackError && (
                  <div className="m-4 rounded-md bg-red-50 p-3">
                    <p className="text-sm text-red-700">{rollbackError}</p>
                  </div>
                )}
                {rollbackSuccess && (
                  <div className="m-4 rounded-md bg-green-50 p-3">
                    <p className="text-sm text-green-700">{rollbackSuccess}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-6 p-4 overflow-y-auto">
                <ImageUploader
                  assets={assets}
                  onAssetsChange={handleAssetsChange}
                  uploadType="logo"
                  label="Logo"
                  description="Upload your brand logo"
                  currentUrl={assets.logoUrl}
                />
                <ImageUploader
                  assets={assets}
                  onAssetsChange={handleAssetsChange}
                  uploadType="background"
                  label="Background Image"
                  description="Upload a background image for the login page"
                  currentUrl={assets.backgroundImageUrl}
                />
                <ImageUploader
                  assets={assets}
                  onAssetsChange={handleAssetsChange}
                  uploadType="favicon"
                  label="Favicon"
                  description="Upload a favicon (32x32 or 16x16 recommended)"
                  currentUrl={assets.faviconUrl}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
