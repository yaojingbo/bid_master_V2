/**
 * AI settings store using Zustand.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface Provider {
  id: string;
  name: string;
  models: string[];
}

interface SettingsState {
  // Providers
  providers: Provider[];
  activeProvider: string;
  activeModel: string;

  // Connection status
  isTesting: boolean;
  lastTestResult: {
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null;

  // Actions
  setProviders: (providers: Provider[]) => void;
  setActiveProvider: (providerId: string) => void;
  setActiveModel: (model: string) => void;
  setTesting: (isTesting: boolean) => void;
  setTestResult: (result: SettingsState["lastTestResult"]) => void;
}

const DEFAULT_MODELS: Record<string, string> = {
  deepseek: "deepseek-v4-flash",
  dashscope: "qwen-turbo",
  zhipu: "glm-4-flash",
  minimax: "MiniMax-M2.7",
  openai: "gpt-4o",
  claude: "claude-sonnet-4-6",
  ollama: "llama3",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      providers: [],
      activeProvider: "deepseek",
      activeModel: DEFAULT_MODELS["deepseek"],
      isTesting: false,
      lastTestResult: null,

      setProviders: (providers) => set(() => ({ providers })),

      setActiveProvider: (providerId) => {
        const providers = get().providers;
        const provider = providers.find((p) => p.id === providerId);
        const defaultModel = DEFAULT_MODELS[providerId] || provider?.models[0] || "";
        set(() => ({
          activeProvider: providerId,
          activeModel: defaultModel,
        }));
      },

      setActiveModel: (model) => set(() => ({ activeModel: model })),

      setTesting: (isTesting) => set(() => ({ isTesting })),

      setTestResult: (result) => set(() => ({
        lastTestResult: result,
        isTesting: false,
      })),
    }),
    {
      name: "bid-master-settings-store",
    }
  )
);