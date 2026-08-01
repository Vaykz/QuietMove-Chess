import type { AiModel, AiProvider } from "../domain/types";

export interface AiModelOption {
  id: AiModel;
  provider: AiProvider;
  label: string;
  quality: "flagship" | "balanced";
}

export const aiModels: AiModelOption[] = [
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    label: "GPT-5.6 Sol",
    quality: "flagship"
  },
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    label: "GPT-5.6 Terra",
    quality: "balanced"
  },
  {
    id: "gemini-3.5-flash",
    provider: "gemini",
    label: "Gemini 3.5 Flash",
    quality: "flagship"
  },
  {
    id: "gemini-3.6-flash",
    provider: "gemini",
    label: "Gemini 3.6 Flash",
    quality: "balanced"
  }
];

export const defaultModelByProvider: Record<AiProvider, AiModel> = {
  openai: "gpt-5.6-sol",
  gemini: "gemini-3.5-flash"
};

export function modelsForProvider(provider: AiProvider) {
  return aiModels.filter((model) => model.provider === provider);
}

export function modelBelongsToProvider(provider: AiProvider, model: string): model is AiModel {
  return aiModels.some((item) => item.provider === provider && item.id === model);
}
