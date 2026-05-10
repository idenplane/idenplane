import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import type {
  ThemeStyles,
  ThemeComponent,
  ThemeAssets,
  ThemeSettings,
  ThemeComponent as DraggableComponent,
} from '../../types/theme';
import {
  DEFAULT_THEME_STYLES,
  DEFAULT_THEME_COMPONENTS,
  DEFAULT_THEME_ASSETS,
  DEFAULT_THEME_SETTINGS,
} from '../../types/theme';
import ComponentPalette from './ComponentPalette';
import ThemeCanvas from './ThemeCanvas';
import LivePreview from './LivePreview';
import StyleEditor from './StyleEditor';
import ImageUploader from './ImageUploader';
import ThemeTemplates from './ThemeTemplates';

// ─── Viewport type ─────────────────────────────────────────────────────────────

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

// ─── Layout sections ──────────────────────────────────────────────────────────

type LayoutSection = 'canvas' | 'preview';

// ─── Editor panel type ────────────────────────────────────────────────────────

type EditorPanel = 'palette' | 'canvas' | 'styles' | 'assets' | 'templates';

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

  const handleSettingsChange = useCallback((updated: Partial<ThemeSettings>) => {
    setSettings((prev) => ({ ...prev, ...updated }));
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
      setAssets((prev) => ({ ...prev, logoUrl: template.assets.logoUrl }));
    }
    if (template.assets.backgroundImageUrl !== undefined) {
      setAssets((prev) => ({ ...prev, backgroundImageUrl: template.assets.backgroundImageUrl }));
    }
    if (template.assets.faviconUrl !== undefined) {
      setAssets((prev) => ({ ...prev, faviconUrl: template.assets.faviconUrl }));
    }
    setSettings((prev) => ({ ...prev, ...template.settings }));
  }, []);

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
        </div>
        <div className="flex items-center gap-2">
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
