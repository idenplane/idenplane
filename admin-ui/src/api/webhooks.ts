import apiClient from './client';

export interface Webhook {
  id: string;
  realmId: string;
  url: string;
  description: string | null;
  enabled: boolean;
  eventTypes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  statusCode: number | null;
  success: boolean;
  requestBody: unknown;
  responseBody: string | null;
  duration: number | null;
  attempt: number;
  createdAt: string;
}

export interface CreateWebhookDto {
  url: string;
  secret: string;
  eventTypes: string[];
  description?: string;
  enabled?: boolean;
}

export interface UpdateWebhookDto {
  url?: string;
  secret?: string;
  eventTypes?: string[];
  description?: string;
  enabled?: boolean;
}

export async function getWebhooks(realmName: string): Promise<Webhook[]> {
  const { data } = await apiClient.get<Webhook[]>(`/realms/${realmName}/webhooks`);
  return data;
}

export async function getWebhook(realmName: string, id: string): Promise<Webhook> {
  const { data } = await apiClient.get<Webhook>(`/realms/${realmName}/webhooks/${id}`);
  return data;
}

export async function createWebhook(realmName: string, dto: CreateWebhookDto): Promise<Webhook> {
  const { data } = await apiClient.post<Webhook>(`/realms/${realmName}/webhooks`, dto);
  return data;
}

export async function updateWebhook(realmName: string, id: string, dto: UpdateWebhookDto): Promise<Webhook> {
  const { data } = await apiClient.put<Webhook>(`/realms/${realmName}/webhooks/${id}`, dto);
  return data;
}

export async function deleteWebhook(realmName: string, id: string): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/webhooks/${id}`);
}

export async function testWebhook(realmName: string, id: string): Promise<void> {
  await apiClient.post(`/realms/${realmName}/webhooks/${id}/test`);
}

export async function getWebhookDeliveries(realmName: string, id: string): Promise<WebhookDelivery[]> {
  const { data } = await apiClient.get<WebhookDelivery[]>(`/realms/${realmName}/webhooks/${id}/deliveries`);
  return data;
}
