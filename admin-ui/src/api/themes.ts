import apiClient from './client';
import type {
  Theme,
  ThemeVersion,
  ThemeTemplate,
  ThemeStyles,
  ThemeComponent,
  ThemeAssets,
  ThemeSettings,
} from '../types/theme';

export interface CreateThemePayload {
  name: string;
  description?: string;
  themeType: 'login' | 'account' | 'email' | 'full';
  styles?: ThemeStyles;
  components?: ThemeComponent[];
  assets?: Partial<ThemeAssets>;
  settings?: Partial<ThemeSettings>;
}

export interface UpdateThemePayload {
  description?: string;
  styles?: Partial<ThemeStyles>;
  components?: ThemeComponent[];
  assets?: Partial<ThemeAssets>;
  settings?: Partial<ThemeSettings>;
}

export interface ThemeListParams {
  themeType?: 'login' | 'account' | 'email' | 'full';
  status?: 'draft' | 'published' | 'archived';
  isActive?: boolean;
}

export async function getThemes(
  realmName: string,
  params?: ThemeListParams,
): Promise<Theme[]> {
  const searchParams = new URLSearchParams();
  if (params?.themeType) searchParams.set('themeType', params.themeType);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));

  const queryString = searchParams.toString();
  const { data } = await apiClient.get<Theme[]>(
    `/realms/${realmName}/themes${queryString ? `?${queryString}` : ''}`,
  );
  return data;
}

export async function getThemeById(
  realmName: string,
  id: string,
): Promise<Theme> {
  const { data } = await apiClient.get<Theme>(
    `/realms/${realmName}/themes/${id}`,
  );
  return data;
}

export async function createTheme(
  realmName: string,
  payload: CreateThemePayload,
): Promise<Theme> {
  const { data } = await apiClient.post<Theme>(
    `/realms/${realmName}/themes`,
    payload,
  );
  return data;
}

export async function updateTheme(
  realmName: string,
  id: string,
  payload: UpdateThemePayload,
): Promise<Theme> {
  const { data } = await apiClient.put<Theme>(
    `/realms/${realmName}/themes/${id}`,
    payload,
  );
  return data;
}

export async function deleteTheme(
  realmName: string,
  id: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/themes/${id}`);
}

export async function publishTheme(
  realmName: string,
  id: string,
): Promise<Theme> {
  const { data } = await apiClient.post<Theme>(
    `/realms/${realmName}/themes/${id}/publish`,
  );
  return data;
}

export async function archiveTheme(
  realmName: string,
  id: string,
): Promise<Theme> {
  const { data } = await apiClient.post<Theme>(
    `/realms/${realmName}/themes/${id}/archive`,
  );
  return data;
}

export async function duplicateTheme(
  realmName: string,
  id: string,
  newName: string,
): Promise<Theme> {
  const { data } = await apiClient.post<Theme>(
    `/realms/${realmName}/themes/${id}/duplicate`,
    { name: newName },
  );
  return data;
}

export async function setActiveTheme(
  realmName: string,
  id: string,
): Promise<Theme> {
  const { data } = await apiClient.post<Theme>(
    `/realms/${realmName}/themes/${id}/activate`,
  );
  return data;
}

export async function getThemeVersions(
  realmName: string,
  id: string,
): Promise<ThemeVersion[]> {
  const { data } = await apiClient.get<ThemeVersion[]>(
    `/realms/${realmName}/themes/${id}/versions`,
  );
  return data;
}

export async function rollbackTheme(
  realmName: string,
  id: string,
  version: number,
): Promise<Theme> {
  const { data } = await apiClient.post<Theme>(
    `/realms/${realmName}/themes/${id}/restore/${version}`,
  );
  return data;
}

export async function getThemeTemplates(): Promise<ThemeTemplate[]> {
  const { data } = await apiClient.get<ThemeTemplate[]>('/themes/templates');
  return data;
}

export async function exportTheme(
  realmName: string,
  id: string,
): Promise<Record<string, unknown>> {
  const { data } = await apiClient.get<Record<string, unknown>>(
    `/realms/${realmName}/themes/${id}/export`,
  );
  return data;
}

export interface ImportThemeOptions {
  overwrite?: boolean;
  activate?: boolean;
}

export async function importTheme(
  realmName: string,
  payload: Record<string, unknown>,
  options?: ImportThemeOptions,
): Promise<Theme> {
  const params = new URLSearchParams();
  if (options?.overwrite) params.set('overwrite', 'true');
  if (options?.activate) params.set('activate', 'true');

  const queryString = params.toString();
  const { data } = await apiClient.post<Theme>(
    `/realms/${realmName}/themes/import${queryString ? `?${queryString}` : ''}`,
    payload,
  );
  return data;
}

export interface UploadedAsset {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface RenderPreviewParams {
  styles?: ThemeStyles;
  components?: ThemeComponent[];
  assets?: Partial<ThemeAssets>;
  settings?: Partial<ThemeSettings>;
}

export interface RenderPreviewResponse {
  html: string;
}

export async function renderThemePreview(
  realmName: string,
  params: RenderPreviewParams,
): Promise<RenderPreviewResponse> {
  const { data } = await apiClient.post<RenderPreviewResponse>(
    `/realms/${realmName}/themes/preview`,
    params,
  );
  return data;
}

export async function uploadThemeAsset(
  realmName: string,
  id: string,
  file: File,
): Promise<UploadedAsset> {
  const formData = new FormData();
  formData.append('file', file);

  const { data } = await apiClient.post<UploadedAsset>(
    `/realms/${realmName}/themes/${id}/assets`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    },
  );
  return data;
}

export async function deleteThemeAsset(
  realmName: string,
  id: string,
  assetId: string,
): Promise<void> {
  await apiClient.delete(
    `/realms/${realmName}/themes/${id}/assets/${assetId}`,
  );
}
