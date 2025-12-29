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
  SimulateKey: (keyData: any) => {
    handled: boolean;
  };
}

// Create type-safe messaging functions
export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
