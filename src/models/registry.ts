import OpenAI from 'openai';
import { ProviderConfig, ModelConfig, ModelComplexity, ModelSpecialty } from './config.js';

export class ModelRegistry {
  private providers: Map<string, ProviderConfig> = new Map();
  private providerClients: Map<string, OpenAI> = new Map();
  private providerCredentials: Map<string, { apiKey: string; baseURL: string; headers?: Record<string, string> }> = new Map();
  private models: Map<string, ModelConfig> = new Map();
  private providerModels: Map<string, Set<string>> = new Map();

  registerProvider(provider: ProviderConfig): void {
    this.providers.set(provider.id, provider);
    this.providerCredentials.set(provider.id, {
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
      headers: provider.headers,
    });
    if (provider.apiKey) {
      this.ensureClient(provider);
    }
  }

  registerModel(model: ModelConfig): void {
    this.models.set(model.id, model);

    const set = this.providerModels.get(model.provider) ?? new Set<string>();
    set.add(model.id);
    this.providerModels.set(model.provider, set);
  }

  unregisterModel(modelId: string): boolean {
    const model = this.models.get(modelId);
    if (!model) return false;

    this.models.delete(modelId);
    const set = this.providerModels.get(model.provider);
    if (set) {
      set.delete(modelId);
      if (set.size === 0) {
        this.providerModels.delete(model.provider);
      }
    }
    return true;
  }

  getProvider(providerId: string): ProviderConfig | undefined {
    return this.providers.get(providerId);
  }

  getModel(modelId: string): ModelConfig | undefined {
    return this.models.get(modelId);
  }

  getClient(providerId: string): OpenAI | undefined {
    const client = this.providerClients.get(providerId);
    if (client) return client;

    const provider = this.providers.get(providerId);
    if (!provider) return undefined;

    const credentials = this.providerCredentials.get(providerId);
    if (!credentials?.apiKey) return undefined;

    return this.ensureClient({
      ...provider,
      apiKey: credentials.apiKey,
      baseURL: credentials.baseURL ?? provider.baseURL,
      headers: credentials.headers ?? provider.headers,
    });
  }

  getClientForModel(modelId: string): OpenAI | undefined {
    const model = this.models.get(modelId);
    if (!model) return undefined;

    const client = this.getClient(model.provider);
    if (client) return client;

    const provider = this.providers.get(model.provider);
    if (!provider) return undefined;

    const credentials = this.providerCredentials.get(model.provider);
    if (!credentials?.apiKey) return undefined;

    return this.ensureClient({
      ...provider,
      apiKey: credentials.apiKey,
      baseURL: credentials.baseURL ?? provider.baseURL,
      headers: credentials.headers ?? provider.headers,
    });
  }

  listProviders(): ProviderConfig[] {
    return Array.from(this.providers.values());
  }

  listModels(providerId?: string): ModelConfig[] {
    const all = Array.from(this.models.values());
    if (!providerId) return all;
    return all.filter((m) => m.provider === providerId);
  }

  listModelsForProvider(providerId: string): ModelConfig[] {
    const ids = this.providerModels.get(providerId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.models.get(id))
      .filter((m): m is ModelConfig => Boolean(m));
  }

  getDefaultProvider(): ProviderConfig | undefined {
    for (const p of this.providers.values()) {
      if (p.isDefault) return p;
    }
    return this.providers.values().next().value;
  }

  getModelsByComplexity(complexity: ModelComplexity): ModelConfig[] {
    return Array.from(this.models.values()).filter((m) => m.complexity === complexity);
  }

  getModelsBySpecialty(specialty: ModelSpecialty): ModelConfig[] {
    return Array.from(this.models.values()).filter((m) =>
      (m.specialties ?? []).includes(specialty)
    );
  }

  getCheapestModel(): ModelConfig | undefined {
    const models = Array.from(this.models.values());
    if (models.length === 0) return undefined;

    return models.reduce((cheapest, model) => {
      const cheapestCost = (cheapest.pricingPer1kInput ?? Infinity) + (cheapest.pricingPer1kOutput ?? Infinity);
      const modelCost = (model.pricingPer1kInput ?? Infinity) + (model.pricingPer1kOutput ?? Infinity);
      return modelCost < cheapestCost ? model : cheapest;
    });
  }

  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  hasModel(modelId: string): boolean {
    return this.models.has(modelId);
  }

  clear(): void {
    this.providers.clear();
    this.providerClients.clear();
    this.models.clear();
    this.providerModels.clear();
  }

  private ensureClient(provider: ProviderConfig): OpenAI {
    const existing = this.providerClients.get(provider.id);
    if (existing) return existing;

    const client = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
      defaultHeaders: provider.headers,
    });

    this.providerClients.set(provider.id, client);
    return client;
  }
}
