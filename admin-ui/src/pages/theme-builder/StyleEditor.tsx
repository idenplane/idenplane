import { useState, type ChangeEvent } from 'react';
import type { ThemeStyles, ThemeColors, ThemeAssets } from '../../types/theme';
import ImageUploader from './ImageUploader';

interface StyleEditorProps {
  styles: ThemeStyles;
  assets: ThemeAssets;
  onChange: (styles: ThemeStyles) => void;
  onAssetsChange: (assets: ThemeAssets) => void;
}

// Color picker field component
function ColorField({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex flex-col">
        <label className="text-sm font-medium text-muted">{label}</label>
        {description && (
          <span className="text-xs text-subtle">{description}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded border border-line-strong p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          className="w-24 rounded-md border border-line-strong px-2 py-1 text-sm uppercase shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        />
      </div>
    </div>
  );
}

// Section header component
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-line py-3">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {subtitle && <p className="text-xs text-subtle">{subtitle}</p>}
    </div>
  );
}

export default function StyleEditor({
  styles,
  assets,
  onChange,
  onAssetsChange,
}: StyleEditorProps) {
  const [activeTab, setActiveTab] = useState<'colors' | 'typography' | 'spacing' | 'borders' | 'shadows' | 'logo'>('colors');

  const handleColorChange = (key: keyof ThemeColors, value: string) => {
    onChange({
      ...styles,
      colors: {
        ...styles.colors,
        [key]: value,
      },
    });
  };

  const handleTypographyChange = (key: string, value: string | number) => {
    onChange({
      ...styles,
      typography: {
        ...styles.typography,
        [key]: value,
      },
    });
  };

  const handleSpacingChange = (key: string, value: string) => {
    onChange({
      ...styles,
      spacing: {
        ...styles.spacing,
        [key]: value,
      },
    });
  };

  const handleBorderChange = (key: string, value: string) => {
    onChange({
      ...styles,
      borders: {
        ...styles.borders,
        [key]: value,
      },
    });
  };

  const handleShadowChange = (key: string, value: string) => {
    onChange({
      ...styles,
      shadows: {
        ...styles.shadows,
        [key]: value,
      },
    });
  };

  const tabs = [
    { key: 'colors' as const, label: 'Colors' },
    { key: 'typography' as const, label: 'Typography' },
    { key: 'spacing' as const, label: 'Spacing' },
    { key: 'borders' as const, label: 'Borders' },
    { key: 'shadows' as const, label: 'Shadows' },
    { key: 'logo' as const, label: 'Logo' },
  ];

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Tabs */}
      <div className="flex border-b border-line">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-accent text-accent'
                : 'border-transparent text-subtle hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Colors Tab */}
        {activeTab === 'colors' && (
          <div className="space-y-1">
            <SectionHeader
              title="Primary Colors"
              subtitle="Main brand colors for buttons and links"
            />
            <ColorField
              label="Primary"
              value={styles.colors.primaryColor}
              onChange={(v) => handleColorChange('primaryColor', v)}
              description="Main brand color"
            />
            <ColorField
              label="Primary Hover"
              value={styles.colors.primaryHoverColor}
              onChange={(v) => handleColorChange('primaryHoverColor', v)}
              description="Color on button hover"
            />
            <ColorField
              label="Primary Active"
              value={styles.colors.primaryActiveColor}
              onChange={(v) => handleColorChange('primaryActiveColor', v)}
              description="Color when button is pressed"
            />
            <ColorField
              label="Secondary"
              value={styles.colors.secondaryColor}
              onChange={(v) => handleColorChange('secondaryColor', v)}
              description="Secondary actions and accents"
            />

            <div className="pt-4">
              <SectionHeader
                title="Background Colors"
                subtitle="Colors for backgrounds and cards"
              />
              <ColorField
                label="Background"
                value={styles.colors.backgroundColor}
                onChange={(v) => handleColorChange('backgroundColor', v)}
                description="Page background"
              />
              <ColorField
                label="Card"
                value={styles.colors.cardColor}
                onChange={(v) => handleColorChange('cardColor', v)}
                description="Card and form background"
              />
              <ColorField
                label="Surface"
                value={styles.colors.surfaceColor}
                onChange={(v) => handleColorChange('surfaceColor', v)}
                description="Elevated surfaces"
              />
            </div>

            <div className="pt-4">
              <SectionHeader
                title="Text Colors"
                subtitle="Colors for text content"
              />
              <ColorField
                label="Primary Text"
                value={styles.colors.textColor}
                onChange={(v) => handleColorChange('textColor', v)}
                description="Main text color"
              />
              <ColorField
                label="Secondary Text"
                value={styles.colors.textSecondaryColor}
                onChange={(v) => handleColorChange('textSecondaryColor', v)}
                description="Muted and helper text"
              />
              <ColorField
                label="Border"
                value={styles.colors.borderColor}
                onChange={(v) => handleColorChange('borderColor', v)}
                description="Border and divider color"
              />
            </div>

            <div className="pt-4">
              <SectionHeader
                title="Status Colors"
                subtitle="Colors for alerts and status indicators"
              />
              <ColorField
                label="Error"
                value={styles.colors.errorColor}
                onChange={(v) => handleColorChange('errorColor', v)}
                description="Error messages and alerts"
              />
              <ColorField
                label="Warning"
                value={styles.colors.warningColor}
                onChange={(v) => handleColorChange('warningColor', v)}
                description="Warning messages"
              />
              <ColorField
                label="Success"
                value={styles.colors.successColor}
                onChange={(v) => handleColorChange('successColor', v)}
                description="Success messages"
              />
              <ColorField
                label="Info"
                value={styles.colors.infoColor}
                onChange={(v) => handleColorChange('infoColor', v)}
                description="Information messages"
              />
            </div>
          </div>
        )}

        {/* Typography Tab */}
        {activeTab === 'typography' && (
          <div className="space-y-4">
            <SectionHeader
              title="Font Family"
              subtitle="Primary and fallback fonts"
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Primary Font
              </label>
              <select
                value={styles.typography.fontFamily}
                onChange={(e) => handleTypographyChange('fontFamily', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="Inter, system-ui, -apple-system, sans-serif">Inter</option>
                <option value="Roboto, system-ui, -apple-system, sans-serif">Roboto</option>
                <option value="Open Sans, system-ui, -apple-system, sans-serif">Open Sans</option>
                <option value="Poppins, system-ui, -apple-system, sans-serif">Poppins</option>
                <option value="Montserrat, system-ui, -apple-system, sans-serif">Montserrat</option>
                <option value="Lato, system-ui, -apple-system, sans-serif">Lato</option>
                <option value="system-ui, -apple-system, BlinkMacSystemFont, sans-serif">System Default</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Font Size Base
              </label>
              <select
                value={styles.typography.fontSizeBase}
                onChange={(e) => handleTypographyChange('fontSizeBase', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="14px">14px</option>
                <option value="15px">15px</option>
                <option value="16px">16px</option>
                <option value="17px">17px</option>
                <option value="18px">18px</option>
              </select>
            </div>

            <SectionHeader title="Font Sizes" subtitle="Text size scale" />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-xs text-subtle">Small</label>
                <select
                  value={styles.typography.fontSizeSmall}
                  onChange={(e) => handleTypographyChange('fontSizeSmall', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="12px">12px</option>
                  <option value="13px">13px</option>
                  <option value="14px">14px</option>
                  <option value="15px">15px</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-subtle">Base</label>
                <select
                  value={styles.typography.fontSizeBase}
                  onChange={(e) => handleTypographyChange('fontSizeBase', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="14px">14px</option>
                  <option value="15px">15px</option>
                  <option value="16px">16px</option>
                  <option value="17px">17px</option>
                  <option value="18px">18px</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-subtle">Large</label>
                <select
                  value={styles.typography.fontSizeLarge}
                  onChange={(e) => handleTypographyChange('fontSizeLarge', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="16px">16px</option>
                  <option value="17px">17px</option>
                  <option value="18px">18px</option>
                  <option value="20px">20px</option>
                  <option value="22px">22px</option>
                </select>
              </div>
            </div>

            <SectionHeader title="Font Weights" subtitle="Text weight options" />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-xs text-subtle">Normal</label>
                <select
                  value={styles.typography.fontWeightNormal}
                  onChange={(e) => handleTypographyChange('fontWeightNormal', Number(e.target.value))}
                  className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="300">300 Light</option>
                  <option value="400">400 Regular</option>
                  <option value="500">500 Medium</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-subtle">Medium</label>
                <select
                  value={styles.typography.fontWeightMedium}
                  onChange={(e) => handleTypographyChange('fontWeightMedium', Number(e.target.value))}
                  className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="400">400 Regular</option>
                  <option value="500">500 Medium</option>
                  <option value="600">600 Semi-Bold</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-subtle">Bold</label>
                <select
                  value={styles.typography.fontWeightBold}
                  onChange={(e) => handleTypographyChange('fontWeightBold', Number(e.target.value))}
                  className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="600">600 Semi-Bold</option>
                  <option value="700">700 Bold</option>
                  <option value="800">800 Extra-Bold</option>
                </select>
              </div>
            </div>

            <SectionHeader title="Line Height & Spacing" />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Line Height
              </label>
              <select
                value={styles.typography.lineHeight}
                onChange={(e) => handleTypographyChange('lineHeight', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="1.25">1.25 (Tight)</option>
                <option value="1.375">1.375</option>
                <option value="1.5">1.5 (Normal)</option>
                <option value="1.625">1.625</option>
                <option value="1.75">1.75 (Relaxed)</option>
                <option value="2">2 (Loose)</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Letter Spacing
              </label>
              <select
                value={styles.typography.letterSpacing}
                onChange={(e) => handleTypographyChange('letterSpacing', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="-0.02em">-0.02em (Tight)</option>
                <option value="-0.01em">-0.01em</option>
                <option value="0">0 (Normal)</option>
                <option value="0.01em">0.01em</option>
                <option value="0.02em">0.02em</option>
                <option value="0.05em">0.05em (Wide)</option>
              </select>
            </div>
          </div>
        )}

        {/* Spacing Tab */}
        {activeTab === 'spacing' && (
          <div className="space-y-4">
            <SectionHeader
              title="Spacing Scale"
              subtitle="Consistent spacing values"
            />
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'spacingXs', label: 'XS' },
                { key: 'spacingSm', label: 'Small' },
                { key: 'spacingMd', label: 'Medium' },
                { key: 'spacingLg', label: 'Large' },
                { key: 'spacingXl', label: 'XL' },
                { key: 'spacing2xl', label: '2XL' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="mb-1.5 block text-xs text-subtle">{label}</label>
                  <select
                    value={styles.spacing[key as keyof typeof styles.spacing]}
                    onChange={(e) => handleSpacingChange(key, e.target.value)}
                    className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                  >
                    <option value="2px">2px</option>
                    <option value="4px">4px</option>
                    <option value="8px">8px</option>
                    <option value="12px">12px</option>
                    <option value="16px">16px</option>
                    <option value="20px">20px</option>
                    <option value="24px">24px</option>
                    <option value="32px">32px</option>
                    <option value="48px">48px</option>
                  </select>
                </div>
              ))}
            </div>

            <SectionHeader
              title="Border Radius"
              subtitle="Corner radius for buttons, cards, and inputs"
            />
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">
                  Small Radius
                </label>
                <select
                  value={styles.spacing.borderRadiusSm}
                  onChange={(e) => handleSpacingChange('borderRadiusSm', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="2px">2px</option>
                  <option value="4px">4px</option>
                  <option value="6px">6px</option>
                  <option value="8px">8px</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">
                  Default Radius
                </label>
                <select
                  value={styles.spacing.borderRadius}
                  onChange={(e) => handleSpacingChange('borderRadius', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="4px">4px</option>
                  <option value="6px">6px</option>
                  <option value="8px">8px</option>
                  <option value="10px">10px</option>
                  <option value="12px">12px</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">
                  Large Radius
                </label>
                <select
                  value={styles.spacing.borderRadiusLg}
                  onChange={(e) => handleSpacingChange('borderRadiusLg', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="6px">6px</option>
                  <option value="8px">8px</option>
                  <option value="10px">10px</option>
                  <option value="12px">12px</option>
                  <option value="16px">16px</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">
                  Full Radius (Pills)
                </label>
                <select
                  value={styles.spacing.borderRadiusFull}
                  onChange={(e) => handleSpacingChange('borderRadiusFull', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="9998px">9998px</option>
                  <option value="9999px">9999px</option>
                  <option value="10000px">10000px</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Borders Tab */}
        {activeTab === 'borders' && (
          <div className="space-y-4">
            <SectionHeader
              title="Border Styles"
              subtitle="Default border appearance"
            />
            <ColorField
              label="Border Color"
              value={styles.borders.borderColor}
              onChange={(v) => handleBorderChange('borderColor', v)}
              description="Default border color"
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Border Width
              </label>
              <select
                value={styles.borders.borderWidth}
                onChange={(e) => handleBorderChange('borderWidth', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="0">None</option>
                <option value="1px">1px</option>
                <option value="2px">2px</option>
              </select>
            </div>

            <SectionHeader
              title="Focus State"
              subtitle="Border when input is focused"
            />
            <ColorField
              label="Focus Border Color"
              value={styles.borders.borderColorFocus}
              onChange={(v) => handleBorderChange('borderColorFocus', v)}
              description="Border color on focus"
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Focus Border Width
              </label>
              <select
                value={styles.borders.borderWidthFocus}
                onChange={(e) => handleBorderChange('borderWidthFocus', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="1px">1px</option>
                <option value="2px">2px</option>
                <option value="3px">3px</option>
              </select>
            </div>

            <SectionHeader
              title="Error State"
              subtitle="Border when validation fails"
            />
            <ColorField
              label="Error Border Color"
              value={styles.borders.borderColorError}
              onChange={(v) => handleBorderChange('borderColorError', v)}
              description="Border color on error"
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Error Border Width
              </label>
              <select
                value={styles.borders.borderWidthError}
                onChange={(e) => handleBorderChange('borderWidthError', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="1px">1px</option>
                <option value="2px">2px</option>
                <option value="3px">3px</option>
              </select>
            </div>
          </div>
        )}

        {/* Shadows Tab */}
        {activeTab === 'shadows' && (
          <div className="space-y-4">
            <SectionHeader
              title="Box Shadows"
              subtitle="Elevation and depth effects"
            />
            {[
              { key: 'shadowSm', label: 'Small', description: 'Subtle elevation' },
              { key: 'shadow', label: 'Default', description: 'Standard elevation' },
              { key: 'shadowMd', label: 'Medium', description: 'Card elevation' },
              { key: 'shadowLg', label: 'Large', description: 'Modal elevation' },
              { key: 'shadowXl', label: 'Extra Large', description: 'Popover elevation' },
            ].map(({ key, label, description }) => (
              <div key={key} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-muted">{label}</span>
                  <span className="text-xs text-subtle">{description}</span>
                </div>
                <div
                  className="h-12 w-full rounded"
                  style={{ boxShadow: styles.shadows[key as keyof typeof styles.shadows] as string }}
                />
                <input
                  type="text"
                  value={styles.shadows[key as keyof typeof styles.shadows]}
                  onChange={(e) => handleShadowChange(key, e.target.value)}
                  className="mt-2 w-full rounded-md border border-line-strong px-2 py-1 text-xs font-mono text-muted focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
            ))}

            <SectionHeader
              title="Special Shadows"
              subtitle="Shadows for specific use cases"
            />
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-muted">Focus Shadow</span>
                <span className="text-xs text-subtle">Input focus ring</span>
              </div>
              <div
                className="h-12 w-full rounded border-2 border-accent"
                style={{ boxShadow: styles.shadows.shadowFocus }}
              />
              <input
                type="text"
                value={styles.shadows.shadowFocus}
                onChange={(e) => handleShadowChange('shadowFocus', e.target.value)}
                className="mt-2 w-full rounded-md border border-line-strong px-2 py-1 text-xs font-mono text-muted focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-muted">Card Shadow</span>
                <span className="text-xs text-subtle">Login card</span>
              </div>
              <div
                className="h-12 w-full rounded"
                style={{ boxShadow: styles.shadows.shadowCard }}
              />
              <input
                type="text"
                value={styles.shadows.shadowCard}
                onChange={(e) => handleShadowChange('shadowCard', e.target.value)}
                className="mt-2 w-full rounded-md border border-line-strong px-2 py-1 text-xs font-mono text-muted focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Logo Tab */}
        {activeTab === 'logo' && (
          <div className="space-y-6">
            <SectionHeader
              title="Logo & Branding"
              subtitle="Upload and customize your brand logo"
            />
            <ImageUploader
              assets={assets}
              onAssetsChange={onAssetsChange}
              uploadType="logo"
              label="Logo"
              description="Upload your brand logo (PNG, JPG, SVG)"
              currentUrl={assets.logoUrl}
            />
            <div className="pt-4">
              <SectionHeader
                title="Logo Size"
                subtitle="Adjust the logo display size"
              />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Small</span>
                  <span className="text-xs text-subtle">80px max width</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Medium</span>
                  <span className="text-xs text-subtle">120px max width</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Large</span>
                  <span className="text-xs text-subtle">180px max width</span>
                </div>
              </div>
            </div>
            <div className="pt-4">
              <SectionHeader
                title="Logo Preview"
                subtitle="See how your logo appears on the login page"
              />
              <div className="rounded-lg border border-line bg-sunken p-4">
                <div className="flex flex-col items-center gap-4">
                  {assets.logoUrl ? (
                    <img
                      src={assets.logoUrl}
                      alt={assets.logoAlt || 'Logo preview'}
                      className="max-h-16 max-w-32 rounded object-contain"
                    />
                  ) : (
                    <div className="flex h-16 w-32 items-center justify-center rounded bg-active text-sm text-subtle">
                      No logo uploaded
                    </div>
                  )}
                  <span className="text-xs text-subtle">
                    {assets.logoUrl ? 'Logo displayed on login page' : 'Upload a logo to see preview'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
