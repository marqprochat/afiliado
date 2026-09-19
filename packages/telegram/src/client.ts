export class TelegramApiError extends Error {}

export interface TelegramMe {
  id: number;
  isBot: boolean;
  username?: string;
  firstName: string;
}

export interface TelegramChatUpdate {
  chatId: string;
  title: string;
  kind: string;
  botIsAdmin: boolean;
}

export interface TelegramUpdatesResult {
  nextOffset: number;
  chatUpdates: TelegramChatUpdate[];
}

interface TgChat {
  id: number;
  title?: string;
  type: string;
}
interface TgChatMember {
  status: string;
}
interface TgMyChatMember {
  chat: TgChat;
  new_chat_member: TgChatMember;
}
interface TgUpdate {
  update_id: number;
  my_chat_member?: TgMyChatMember;
}

const ADMIN_STATUSES = new Set(['administrator', 'creator']);

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(method: string) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  private async request<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(this.url(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
    } | null;
    if (!json?.ok) throw new TelegramApiError(json?.description ?? `HTTP ${res.status}`);
    return json.result as T;
  }

  async getMe(): Promise<TelegramMe> {
    const r = await this.request<{ id: number; is_bot: boolean; username?: string; first_name: string }>(
      'getMe',
    );
    return {
      id: r.id,
      isBot: r.is_bot,
      firstName: r.first_name,
      ...(r.username !== undefined ? { username: r.username } : {}),
    };
  }

  /**
   * Long polling: pega as atualizações desde `offset` e extrai só os eventos de
   * my_chat_member (quando o bot é adicionado/promovido/removido de um grupo ou canal) —
   * é a única forma da Bot API de descobrir em quais chats o bot está, não existe um
   * "listar todos os chats" na API.
   */
  async getUpdates(offset: number, timeoutSec = 25): Promise<TelegramUpdatesResult> {
    const updates = await this.request<TgUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSec,
      allowed_updates: ['my_chat_member'],
    });
    let nextOffset = offset;
    const chatUpdates: TelegramChatUpdate[] = [];
    for (const u of updates) {
      nextOffset = Math.max(nextOffset, u.update_id + 1);
      if (u.my_chat_member) {
        const { chat, new_chat_member } = u.my_chat_member;
        chatUpdates.push({
          chatId: String(chat.id),
          title: chat.title ?? String(chat.id),
          kind: chat.type,
          botIsAdmin: ADMIN_STATUSES.has(new_chat_member.status),
        });
      }
    }
    return { nextOffset, chatUpdates };
  }

  async sendMessage(chatId: string, text: string): Promise<{ messageId: number }> {
    const r = await this.request<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    });
    return { messageId: r.message_id };
  }

  async sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<{ messageId: number }> {
    const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl };
    if (caption) body.caption = caption;
    const r = await this.request<{ message_id: number }>('sendPhoto', body);
    return { messageId: r.message_id };
  }
}
