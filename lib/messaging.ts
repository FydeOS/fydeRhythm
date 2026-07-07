import { defineExtensionMessaging } from '@webext-core/messaging';

// Define the protocol map for all messages
interface ProtocolMap {
  GetEngineStatus: () => {
    loading: boolean;
    loaded: boolean;
    schemaList: any[];
    currentSchema: string;
  };
  GetAsciiMode: () => {
    asciiMode: boolean;
  };
  GetRimeLogs: () => {
    logs: string[];
  };
  ReloadRime: () => void;
  RefreshImeMenu: () => void;
  SimulateKey: (keyData: any) => {
    handled: boolean;
  };
  CompileDictPack: (data: { schemaId: string; packName: string; packDictYaml: string }) => {
    ok: boolean;
    warnings: string[];
  };
  ClassifyDictPackEntries: (data: { schemaId: string; packName: string; packDictYaml: string }) => {
    ok: boolean;
    warnings: string[];
    entries: Array<{ text: string; code: string; weight: number }>;
  };
}

// Create type-safe messaging functions
export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
