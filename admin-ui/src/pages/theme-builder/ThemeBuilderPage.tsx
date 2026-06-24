import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  createTheme,
  getThemes,
  publishTheme,
  rollbackTheme,
  setActiveTheme,
  updateTheme,
} from '../../api/themes';
import type {
  ThemeComponent as DraggableComponent,
  ThemeAssets,
  ThemeComponent,
  ThemeSettings,
  ThemeStyles,
  ThemeVersion,
} from '../../types/theme';
import {
  DEFAULT_THEME_ASSETS,
  DEFAULT_THEME_COMPONENTS,
  DEFAULT_THEME_SETTINGS,
  DEFAULT_THEME_STYLES,
} from '../../types/theme';
import ImageUploader from './ImageUploader';
import LivePreview from './LivePreview';
import StyleEditor from './StyleEditor';
import ThemeCanvas from './ThemeCanvas';
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
  // `themeId` is present when navigating from the theme list (edit route).
  const { name: realmName, themeId: routeThemeId } = useParams<{ name: string; themeId?: string }>();

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

  // ── Theme list + active theme resolution ───────────────────────────────────
  //
  // Fetch all themes for the realm. We then pick the first published theme
  // (or the first overall) as the one being edited. If no theme exists yet,
  // we create a draft on first save. This replaces the old 'demo-theme-id'
  // placeholder so the builder is fully wired to the backend.

  const {
    data: themes,
    isLoading: themesLoading,
    refetch: refetchThemes,
  } = useQuery({
    queryKey: ['themes', realmName],
    queryFn: () => getThemes(realmName || ''),
    enabled: !!realmName,
  });

  // When a specific themeId is in the URL, edit that theme; otherwise fall back
  // to the first published theme, then the first overall.
  const activeTheme = routeThemeId
    ? (themes?.find((t) => t.id === routeThemeId) ?? themes?.[0] ?? null)
    : (themes?.find((t) => t.published) ?? themes?.[0] ?? null);
  const themeId = activeTheme?.id ?? null;
  const [currentVersion, setCurrentVersion] = useState<number>(activeTheme?.version ?? 1);

  // When the active theme changes (or loads for the first time), hydrate the
  // editor state from its server-side styles/components/assets/settings.
  useEffect(() => {
    if (!activeTheme) return;
    // Deep-merge server styles with defaults so every nested group
    // (colors, typography, spacing, borders, shadows) always exists. Themes
    // created with partial/empty styles would otherwise crash the editor and
    // live preview when they read e.g. `styles.colors.primaryColor`.
    const loaded = (activeTheme.styles ?? {}) as Partial<ThemeStyles>;
    setStyles({
      ...DEFAULT_THEME_STYLES,
      ...loaded,
      colors: { ...DEFAULT_THEME_STYLES.colors, ...(loaded.colors ?? {}) },
      typography: {
        ...DEFAULT_THEME_STYLES.typography,
        ...(loaded.typography ?? {}),
      },
      spacing: { ...DEFAULT_THEME_STYLES.spacing, ...(loaded.spacing ?? {}) },
      borders: { ...DEFAULT_THEME_STYLES.borders, ...(loaded.borders ?? {}) },
      shadows: { ...DEFAULT_THEME_STYLES.shadows, ...(loaded.shadows ?? {}) },
    });
    if (Array.isArray(activeTheme.components))
      setComponents(activeTheme.components as ThemeComponent[]);
    if (activeTheme.assets) setAssets((prev) => ({ ...prev, ...activeTheme.assets }));
    if (activeTheme.settings) setSettings((prev) => ({ ...prev, ...activeTheme.settings }));
    if (activeTheme.version) setCurrentVersion(activeTheme.version);
    // Only re-hydrate when the theme id changes — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  // ── Rollback notification state ────────────────────────────────────────────

  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackSuccess, setRollbackSuccess] = useState<string | null>(null);

  // ── Activate state ────────────────────────────────────────────────────────

  const [isActivating, setIsActivating] = useState(false);
  const [activateSuccess, setActivateSuccess] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

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

  const handleSave = useCallback(async (reason: 'manual' | 'auto-save' = 'manual'): Promise<string | null> => {
    if (isSaving) return themeId;

    setIsSaving(true);
    setSaveError(null);

    let resolvedId: string | null = themeId;
    try {
      const currentState = themeStateRef.current;
      if (themeId) {
        // Update the existing theme.
        await updateTheme(realmName || '', themeId, {
          styles: currentState.styles,
          components: currentState.components,
          assets: currentState.assets,
          settings: currentState.settings,
        });
      } else {
        // No theme exists yet for this realm — create a draft and remember it.
        const created = await createTheme(realmName || '', {
          name: `${realmName || 'realm'}-login`,
          themeType: 'login',
          styles: currentState.styles,
          components: currentState.components,
          assets: currentState.assets,
          settings: currentState.settings,
        });
        resolvedId = created.id;
        // Refresh the list so activeTheme resolves to the newly created theme.
        await refetchThemes();
      }
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      return resolvedId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save changes';
      setSaveError(message);
      // Don't throw - auto-save failures shouldn't break the editor
      if (reason === 'manual') {
        throw err;
      }
      return resolvedId;
    } finally {
      setIsSaving(false);
    }
  }, [realmName, themeId, isSaving, refetchThemes]);

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

    setIsPublishing(true);
    setSaveError(null);
    setPublishSuccess(null);

    try {
      // First save any pending changes (this also creates the theme if none
      // exists yet) and use the id it resolves so we never publish "undefined".
      const id = await handleSave('manual');
      if (!id) {
        throw new Error('Could not resolve a theme to publish');
      }

      // Then publish
      const result = await publishTheme(realmName || '', id);

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
  }, [realmName, isPublishing, handleSave]);

  // ── Rollback handler ─────────────────────────────────────────────────────

  // ── Activate handler ──────────────────────────────────────────────────────

  const handleActivate = useCallback(async () => {
    if (!themeId || isActivating) return;
    setIsActivating(true);
    setActivateError(null);
    setActivateSuccess(null);
    try {
      await setActiveTheme(realmName || '', themeId);
      await refetchThemes();
      setActivateSuccess('Theme is now active for this realm');
      setTimeout(() => setActivateSuccess(null), 3000);
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : 'Failed to activate theme');
    } finally {
      setIsActivating(false);
    }
  }, [realmName, themeId, isActivating, refetchThemes]);

  const handleRollback = useCallback(async (version: ThemeVersion) => {
    setRollbackError(null);
    setRollbackSuccess(null);

    try {
      // The backend restore endpoint expects the numeric version number,
      // not the version UUID. Use `version.version` here.
      const updatedTheme = await rollbackTheme(realmName || '', themeId!, String(version.version));
      // Update theme state with the rolled-back data
      if (updatedTheme.styles) {
        setStyles(updatedTheme.styles as ThemeStyles);
      }
      if (updatedTheme.components) {
        setComponents(updatedTheme.components as ThemeComponent[]);
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

  if (themesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
          <span className="text-sm">Loading themes…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Theme Builder</h1>
          <span className="rounded bg-gray-100 px-2 py-1 text-sm text-gray-600">
            Realm: {realmName}
          </span>
          {activeTheme && (
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">
                {activeTheme.displayName || activeTheme.name}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${activeTheme.published
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                  }`}
              >
                {activeTheme.published ? 'Published' : 'Draft'}
              </span>
            </span>
          )}
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
            title="Save your changes as a draft without making them live"
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
            title="Publish this theme so it can be activated for the realm"
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
          {/* Activate button — only shown when a published theme exists */}
          {activeTheme?.published && (
            <button
              onClick={handleActivate}
              disabled={isActivating || isSaving}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Set this theme as the active theme for this realm"
            >
              {isActivating ? (
                <span className="flex items-center gap-1.5">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Activating…
                </span>
              ) : (
                'Activate'
              )}
            </button>
          )}
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
          {activateSuccess && (
            <span className="rounded bg-emerald-50 px-2 py-1 text-sm text-emerald-700">
              {activateSuccess}
            </span>
          )}
          {activateError && (
            <span className="rounded bg-red-50 px-2 py-1 text-sm text-red-600">
              {activateError}
            </span>
          )}
          <button
            onClick={() => setActiveSection('canvas')}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${activeSection === 'canvas'
              ? 'bg-indigo-100 text-indigo-700'
              : 'text-gray-600 hover:bg-gray-100'
              }`}
          >
            Editor
          </button>
          <button
            onClick={() => setActiveSection('preview')}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${activeSection === 'preview'
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
        {/* Middle: Canvas or Live Preview */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Section tabs */}
          <div className="flex border-b border-gray-200 bg-white px-4">
            <button
              onClick={() => setActiveSection('canvas')}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${activeSection === 'canvas'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Edit Layout
            </button>
            <button
              onClick={() => setActiveSection('preview')}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${activeSection === 'preview'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Full Preview
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
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${editorPanel === 'canvas'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Live Preview
              </button>
              <button
                onClick={() => setEditorPanel('styles')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${editorPanel === 'styles'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Styles
              </button>
              <button
                onClick={() => setEditorPanel('assets')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${editorPanel === 'assets'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Assets
              </button>
              <button
                onClick={() => setEditorPanel('templates')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${editorPanel === 'templates'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Templates
              </button>
              <button
                onClick={() => setEditorPanel('history')}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${editorPanel === 'history'
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
                  themeId={themeId || ''}
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
