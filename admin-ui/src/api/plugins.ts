import apiClient from './client';

export interface Plugin {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  author?: string;
  homepage?: string;
}

export async function getPlugins(): Promise<Plugin[]> {
  const { data } = await apiClient.get<Plugin[]>('/plugins');
  return data;
}

export async function getPlugin(name: string): Promise<Plugin> {
  const { data } = await apiClient.get<Plugin>(`/plugins/${name}`);
  return data;
}

export async function enablePlugin(name: string): Promise<Plugin> {
  const { data } = await apiClient.post<Plugin>(`/plugins/${name}/enable`);
  return data;
}

export async function disablePlugin(name: string): Promise<Plugin> {
  const { data } = await apiClient.post<Plugin>(`/plugins/${name}/disable`);
  return data;
}

export async function deletePlugin(name: string): Promise<void> {
  await apiClient.delete(`/plugins/${name}`);
}
