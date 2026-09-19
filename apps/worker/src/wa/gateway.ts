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
export type GroupParticipantAction = 'add' | 'remove' | 'promote' | 'demote';
export interface GroupDetails {
  jid: string;
  subject: string;
  description: string | null;
  announceOnly: boolean;
  inviteCode: string | null;
  participants: { jid: string; admin: 'admin' | 'superadmin' | null }[];
}
export interface WhatsAppGateway {
  isConnected(sessionId: string): boolean;
  sendMessage(sessionId: string, jid: string, msg: OutgoingMessage): Promise<{ messageId: string }>;
  fetchGroups(sessionId: string): Promise<GroupInfo[]>;
  onMessage(handler: (msg: IncomingGroupMessage) => void): void;
  downloadMedia(sessionId: string, message: unknown): Promise<Buffer>;
  createGroup(sessionId: string, subject: string, participantPhones: string[]): Promise<{ jid: string }>;
  updateGroupParticipants(
    sessionId: string,
    jid: string,
    action: GroupParticipantAction,
    participantPhones: string[],
  ): Promise<void>;
  updateGroupSettings(
    sessionId: string,
    jid: string,
    settings: { subject?: string; description?: string; announceOnly?: boolean },
  ): Promise<void>;
  getInviteCode(sessionId: string, jid: string, revoke?: boolean): Promise<string>;
  getGroupDetails(sessionId: string, jid: string): Promise<GroupDetails>;
}
