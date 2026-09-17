export interface OutgoingImage {
  kind: 'image';
  imageUrl?: string;
  imageBuffer?: Buffer;
  caption: string;
}
export interface OutgoingPreview {
  kind: 'preview';
  text: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  url: string;
}
export interface OutgoingText {
  kind: 'text';
  text: string;
}
export type OutgoingMessage = OutgoingImage | OutgoingPreview | OutgoingText;
export interface GroupInfo {
  jid: string;
  name: string;
  kind: 'GROUP' | 'COMMUNITY' | 'CHANNEL';
  botIsAdmin: boolean;
  memberCount: number;
  inviteLink?: string;
}
export interface IncomingGroupMessage {
  sessionId: string;
  sourceJid: string;
  msgId: string;
  message: unknown;
}
export interface WhatsAppGateway {
  isConnected(sessionId: string): boolean;
  sendMessage(sessionId: string, jid: string, msg: OutgoingMessage): Promise<{ messageId: string }>;
  fetchGroups(sessionId: string): Promise<GroupInfo[]>;
  onMessage(handler: (msg: IncomingGroupMessage) => void): void;
  downloadMedia(sessionId: string, message: unknown): Promise<Buffer>;
}
