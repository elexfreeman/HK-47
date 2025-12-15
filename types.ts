export interface AudioConfig {
  sampleRate: number;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: string;
  sender: 'HK-47' | 'MEATBAG';
  message: string;
  type: 'info' | 'error' | 'success';
}
