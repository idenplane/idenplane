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
import InspectorSection from './InspectorSection';
import LivePreview from './LivePreview';
import StyleEditor from './StyleEditor';
import ThemeTemplates from './ThemeTemplates';
import ThemeVersionHistory from './ThemeVersionHistory';

// ─── Viewport type ─────────────────────────────────────────────────────────────

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

// ─── Builder step ─────────────────────────────────────────────────────────────

type BuilderStep = 'design' | 'preview' | 'publish';

const STEPS: { id: BuilderStep; label: string }[] = [
  { id: 'design', label: 'Design' },
  { id: 'preview', label: 'Preview' },
  { id: 'publish', label: 'Publish' },
];

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
  const [step, setStep] = useState<BuilderStep>('design');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Theme selected via the in-builder switcher. Takes precedence over the
  // route param / first-published fallback once the user picks one.
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);

  // Inline rename state.
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

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

  // Resolve the theme being edited. Priority:
  //   1. The theme chosen via the in-builder switcher (`selectedThemeId`).
  //   2. The theme id from the URL (edit route).
  //   3. The first published theme, then the first overall.
  const activeTheme =
    (selectedThemeId ? themes?.find((t) => t.id === selectedThemeId) : undefined) ??
    (routeThemeId
      ? (themes?.find((t) => t.id === routeThemeId) ?? themes?.[0] ?? null)
      : (themes?.find((t) => t.published) ?? themes?.[0] ?? null));
  const themeId = activeTheme?.id ?? null;
  const [currentVersion, setCurrentVersion] = useState<number>(activeTheme?.version ?? 1);

  // When the active theme changes (or loads for the first time), hydrate the
  // editor state from its server-side styles/components/assets/settings.
  useEffect(() => {
    if (!activeTheme) return;
    // Loading an existing theme is not a user edit — suppress the next
    // change-detection pass so Save/auto-save aren't triggered on load.
    skipChangeDetectionRef.current = true;
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

  // Dedicated baseline used purely for change detection. It is updated *after*
  // each comparison (inside the auto-save effect), unlike `themeStateRef` which
  // is refreshed by its own effect before the comparison runs — that ordering
  // bug previously made the editor never see changes, leaving Save disabled.
  const changeBaselineRef = useRef({ styles, components, assets, settings });
  // When set, the next change-detection pass is treated as a hydration (theme
  // load / rollback) and does not mark the theme as having unsaved changes.
  const skipChangeDetectionRef = useRef(false);

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
    // Compare against the dedicated baseline (updated below), not the
    // latest-value ref.
    const prev = changeBaselineRef.current;
    const hasChanges =
      prev.styles !== styles ||
      prev.components !== components ||
      prev.assets !== assets ||
      prev.settings !== settings;

    // Always advance the baseline so the next pass compares against current.
    changeBaselineRef.current = { styles, components, assets, settings };

    // Hydration (theme load / rollback) changes state too — don't treat that
    // as an edit that needs saving.
    if (skipChangeDetectionRef.current) {
      skipChangeDetectionRef.current = false;
      setHasUnsavedChanges(false);
      return;
    }

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
      // Restoring a version replaces editor state — treat it like a load.
      skipChangeDetectionRef.current = true;
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

  // ── Theme switcher / create / rename ───────────────────────────────────────

  const [isCreatingTheme, setIsCreatingTheme] = useState(false);

  const handleSelectTheme = useCallback((id: string) => {
    setSelectedThemeId(id);
  }, []);

  const handleChangeThemeType = useCallback(
    async (themeType: 'login' | 'account' | 'email' | 'full') => {
      if (!themeId) return;
      setSaveError(null);
      try {
        await updateTheme(realmName || '', themeId, { themeType });
        await refetchThemes();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to change theme type');
      }
    },
    [realmName, themeId, refetchThemes],
  );

  const handleCreateTheme = useCallback(async () => {
    if (isCreatingTheme) return;
    setIsCreatingTheme(true);
    setSaveError(null);
    try {
      const count = (themes?.length ?? 0) + 1;
      const created = await createTheme(realmName || '', {
        name: `${realmName || 'realm'}-theme-${count}`,
        themeType: 'login',
        styles: DEFAULT_THEME_STYLES,
        components: DEFAULT_THEME_COMPONENTS,
        assets: DEFAULT_THEME_ASSETS,
        settings: DEFAULT_THEME_SETTINGS,
      });
      await refetchThemes();
      setSelectedThemeId(created.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to create theme');
    } finally {
      setIsCreatingTheme(false);
    }
  }, [realmName, themes, isCreatingTheme, refetchThemes]);

  const [isSavingName, setIsSavingName] = useState(false);

  const startRename = useCallback(() => {
    setRenameValue(activeTheme?.displayName || activeTheme?.name || '');
    setIsRenaming(true);
  }, [activeTheme]);

  const submitRename = useCallback(async () => {
    const name = renameValue.trim();
    if (!themeId || !name) {
      setIsRenaming(false);
      return;
    }
    setIsSavingName(true);
    setSaveError(null);
    try {
      await updateTheme(realmName || '', themeId, { displayName: name });
      await refetchThemes();
      setIsRenaming(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to rename theme');
    } finally {
      setIsSavingName(false);
    }
  }, [realmName, themeId, renameValue, refetchThemes]);

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
            <div className="flex items-center gap-2">
              <select
                value={themeId ?? ''}
                onChange={(e) =>
                  e.target.value === '__new__'
                    ? handleCreateTheme()
                    : handleSelectTheme(e.target.value)
                }
                disabled={isCreatingTheme}
                title="Switch between themes or create a new one"
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                {(themes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {(t.displayName || t.name) + (t.published ? '' : ' (draft)')}
                  </option>
                ))}
                <option value="__new__">+ New theme…</option>
              </select>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${activeTheme.published
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
                  }`}
              >
                {activeTheme.published ? 'Published' : 'Draft'}
              </span>
              <select
                value={activeTheme.themeType}
                onChange={(e) =>
                  handleChangeThemeType(
                    e.target.value as 'login' | 'account' | 'email' | 'full',
                  )
                }
                title="Which surface this theme applies to"
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="login">Login</option>
                <option value="account">Account</option>
                <option value="email">Email</option>
                <option value="full">Full</option>
              </select>
              {isRenaming ? (
                <span className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename();
                      if (e.key === 'Escape') setIsRenaming(false);
                    }}
                    className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    onClick={submitRename}
                    disabled={isSavingName}
                    className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                    aria-label="Save name"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setIsRenaming(false)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100"
                    aria-label="Cancel rename"
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <button
                  onClick={startRename}
                  title="Rename theme"
                  aria-label="Rename theme"
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                </button>
              )}
            </div>
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
          {/* Success/Error messages */}
          {saveError && (
            <span className="rounded bg-red-50 px-2 py-1 text-sm text-red-600">
              {saveError}
            </span>
          )}
        </div>
      </div>

      {/* Step progress indicator */}
      <div className="flex items-center border-b border-gray-200 bg-white px-6 py-2.5">
        {STEPS.map((s, i) => {
          const currentIndex = STEPS.findIndex((x) => x.id === step);
          const active = step === s.id;
          const done = currentIndex > i;
          return (
            <div key={s.id} className="flex items-center">
              <button
                onClick={() => setStep(s.id)}
                className="flex items-center gap-2"
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${active
                    ? 'bg-indigo-600 text-white'
                    : done
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-500'
                    }`}
                >
                  {i + 1}
                </span>
                <span
                  className={`text-sm font-medium ${active ? 'text-indigo-700' : 'text-gray-500'}`}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span className="mx-3 h-px w-10 bg-gray-200" />
              )}
            </div>
          );
        })}
        <div className="ml-auto">
          {step !== 'publish' && (
            <button
              onClick={() => {
                const idx = STEPS.findIndex((x) => x.id === step);
                setStep(STEPS[idx + 1].id);
              }}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Next: {STEPS[STEPS.findIndex((x) => x.id === step) + 1].label} →
            </button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {step === 'design' && (
          <>
            {/* Primary pane: an accurate render of the real login page. */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <LivePreview
                styles={styles}
                components={components}
                assets={assets}
                settings={settings}
                viewportSize={viewportSize}
                onViewportChange={handleViewportChange}
              />
            </div>

            {/* Inspector — grouped, collapsible sections */}
            <div className="flex w-[450px] shrink-0 flex-col overflow-y-auto border-l border-gray-200 bg-white">
              <InspectorSection
                title="Login Content"
                subtitle="Text and optional blocks shown on the real login page"
                defaultOpen
              >
                <div className="flex flex-col gap-4 p-4">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-gray-700">Heading</span>
                    <input
                      type="text"
                      value={settings.loginHeading}
                      onChange={(e) =>
                        setSettings((p) => ({ ...p, loginHeading: e.target.value }))
                      }
                      placeholder="e.g. Welcome back"
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-gray-700">Subtitle</span>
                    <input
                      type="text"
                      value={settings.appDescription}
                      onChange={(e) =>
                        setSettings((p) => ({ ...p, appDescription: e.target.value }))
                      }
                      placeholder="e.g. Sign in to your account"
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-gray-700">Footer text</span>
                    <input
                      type="text"
                      value={settings.customFooterText ?? ''}
                      onChange={(e) =>
                        setSettings((p) => ({
                          ...p,
                          customFooterText: e.target.value || null,
                        }))
                      }
                      placeholder="e.g. © 2026 Your Company"
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </label>

                  <div className="mt-2 flex flex-col gap-2 border-t border-gray-100 pt-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Optional blocks
                    </span>
                    {(
                      [
                        ['showRememberMe', 'Remember me'],
                        ['showForgotPassword', 'Forgot password link'],
                        ['showSocialProviders', 'Social / identity providers'],
                        ['showRegistrationLink', 'Registration link'],
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center justify-between text-sm text-gray-700"
                      >
                        <span>{label}</span>
                        <input
                          type="checkbox"
                          checked={settings[key]}
                          onChange={(e) =>
                            setSettings((p) => ({ ...p, [key]: e.target.checked }))
                          }
                          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </label>
                    ))}
                    <p className="mt-1 text-xs text-gray-400">
                      Social and registration blocks also depend on the realm having
                      identity providers / self-registration enabled.
                    </p>
                  </div>
                </div>
              </InspectorSection>

              <InspectorSection title="Styles" subtitle="Colors, typography, spacing">
                <StyleEditor
                  styles={styles}
                  assets={assets}
                  onChange={handleStylesChange}
                  onAssetsChange={handleAssetsChange}
                />
              </InspectorSection>

              <InspectorSection title="Assets" subtitle="Logo, background, favicon">
                <div className="flex flex-col gap-6 p-4">
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
              </InspectorSection>

              <InspectorSection title="Templates" subtitle="Start from a preset">
                <ThemeTemplates
                  onApplyTemplate={handleApplyTemplate}
                  currentTemplateId={null}
                />
              </InspectorSection>
            </div>
          </>
        )}

        {step === 'preview' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <LivePreview
              styles={styles}
              components={components}
              assets={assets}
              settings={settings}
              viewportSize={viewportSize}
              onViewportChange={handleViewportChange}
            />
          </div>
        )}

        {step === 'publish' && (
          <div className="flex-1 overflow-y-auto bg-gray-50">
            <div className="mx-auto max-w-2xl space-y-6 p-8">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Publish {activeTheme?.displayName || activeTheme?.name || 'theme'}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Publish to create a new version, then activate it to make it live
                  for this realm.
                </p>
              </div>

              {/* Status card */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Status</dt>
                    <dd className="mt-0.5 font-medium text-gray-900">
                      {activeTheme?.published ? 'Published' : 'Draft'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Version</dt>
                    <dd className="mt-0.5 font-medium text-gray-900">v{currentVersion}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Changes</dt>
                    <dd className="mt-0.5 font-medium text-gray-900">
                      {hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handlePublish}
                  disabled={isPublishing || isSaving}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPublishing ? 'Publishing…' : 'Publish version'}
                </button>
                {activeTheme?.published && (
                  <button
                    onClick={handleActivate}
                    disabled={isActivating || isSaving}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isActivating ? 'Activating…' : 'Activate for realm'}
                  </button>
                )}
                {publishSuccess && (
                  <span className="text-sm text-green-600">{publishSuccess}</span>
                )}
                {activateSuccess && (
                  <span className="text-sm text-emerald-700">{activateSuccess}</span>
                )}
                {activateError && (
                  <span className="text-sm text-red-600">{activateError}</span>
                )}
              </div>

              {/* Version history */}
              <div className="rounded-lg border border-gray-200 bg-white">
                <ThemeVersionHistory
                  themeId={themeId || ''}
                  realmName={realmName || ''}
                  currentVersion={currentVersion}
                  onRollback={handleRollback}
                />
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
