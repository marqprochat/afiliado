export interface OutgoingImage {
  kind: 'image';
  imageUrl: string;
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
export type OutgoingMessage = OutgoingImage | OutgoingPreview;
export interface GroupInfo {
  jid: string;
  name: string;
  kind: 'GROUP' | 'COMMUNITY' | 'CHANNEL';
  botIsAdmin: boolean;
  memberCount: number;
  inviteLink?: string;
}
export interface WhatsAppGateway {
  isConnected(sessionId: string): boolean;
  sendMessage(sessionId: string, jid: string, msg: OutgoingMessage): Promise<{ messageId: string }>;
  fetchGroups(sessionId: string): Promise<GroupInfo[]>;
}
