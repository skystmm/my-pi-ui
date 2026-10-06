// GENERATED — do not edit. Source: shell-service/system-one/types.ts
// Regenerate with: npm run sync:protocol
export type QType = 'choice' | 'score' | 'noul'
export type Semantics = 'vendor-defined' | 'normalized-entropy' | 'max-probability' | 'unknown'
export type Provider = { id: string; name: string; protocol: 'systemone-http' | 'openrouter-decisions' | 'pi-native'; piProviderId?: string; endpoint: string; auth: { mode: 'none' | 'env' | 'secret' | 'pi'; envVar?: string; credentialId?: string }; timeoutMs: number; credentialStatus?: 'configured' | 'missing' | 'none' | 'pi' }
export type Model = { id: string; providerId: string; name: string; remoteModel?: string; questionTypes: QType[]; confidenceSemantics: Semantics; maxQuestions?: number; maxOptions?: number; lastTest?: { revision: number; at: string; ok: boolean; code?: string } }
export type NativeModel = { provider: string; id: string; name: string; api: string; contextWindow: number }
export type Config = { revision: number; schemaVersion?: number; enabled: boolean; providers: Provider[]; models: Model[]; defaultModelId?: string }
export type Draft = Omit<Config, 'providers'> & { providers: (Provider & { apiKey?: string })[] }
export type Question = { type: QType; instructions: string; criteria?: Record<string, string | null> | string[] }
export type DecisionRequest = { state: unknown; questions: Record<string, Question> }
export type Resolved = { provider: Provider; model: Model; revision: number; key?: string }
export type Result = { actualModel: string; providerId: string; modelConfigId: string; revision: number; latencyMs: number; answers: Record<string, Record<string, unknown>>; usage: unknown; routing?: unknown; confidenceSemantics: Semantics }
export class DecisionError extends Error { constructor(public code: string) { super(code) } }
