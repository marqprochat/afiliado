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

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string | undefined;
  url?: string | undefined;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramPhotoSize {
  fileId: string;
  fileUniqueId: string;
  width: number;
  height: number;
  fileSize?: number | undefined;
}

export interface TelegramMessage {
  messageId: number;
  from?: {
    id: number;
    firstName?: string | undefined;
    username?: string | undefined;
  } | undefined;
  chat: {
    id: number;
    type: string;
    title?: string | undefined;
  };
  date: number;
  text?: string | undefined;
  caption?: string | undefined;
  photo?: TelegramPhotoSize[] | undefined;
  forwardFromChat?: {
    id: number;
    title?: string | undefined;
    type: string;
  } | undefined;
}

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    firstName?: string | undefined;
    username?: string | undefined;
  };
  message?: {
    messageId: number;
    chat: {
      id: number;
      type: string;
    };
    text?: string | undefined;
  } | undefined;
  data?: string | undefined;
}

export interface TelegramUpdatesResult {
  nextOffset: number;
  chatUpdates: TelegramChatUpdate[];
  messages: TelegramMessage[];
  callbackQueries: TelegramCallbackQuery[];
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
interface TgPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}
interface TgRawMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: string; title?: string };
  date: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  forward_from_chat?: { id: number; title?: string; type: string };
}
interface TgRawCallbackQuery {
  id: string;
  from: { id: number; first_name?: string; username?: string };
  message?: TgRawMessage;
  data?: string;
}
interface TgUpdate {
  update_id: number;
  my_chat_member?: TgMyChatMember;
  message?: TgRawMessage;
  callback_query?: TgRawCallbackQuery;
}

const ADMIN_STATUSES = new Set(['administrator', 'creator']);

export interface SendMessageOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  replyToMessageId?: number;
}

export interface EditMessageOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(method: string) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  private fileUrl(filePath: string) {
    return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
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
    const r = await this.request<{
      id: number;
      is_bot: boolean;
      username?: string;
      first_name: string;
    }>('getMe');
    return {
      id: r.id,
      isBot: r.is_bot,
      firstName: r.first_name,
      ...(r.username !== undefined ? { username: r.username } : {}),
    };
  }

  /**
   * Long polling: busca atualizações desde `offset` (chats, mensagens e botões inline).
   */
  async getUpdates(
    offset: number,
    timeoutSec = 25,
    allowedUpdates = ['my_chat_member', 'message', 'callback_query'],
  ): Promise<TelegramUpdatesResult> {
    const updates = await this.request<TgUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSec,
      allowed_updates: allowedUpdates,
    });
    let nextOffset = offset;
    const chatUpdates: TelegramChatUpdate[] = [];
    const messages: TelegramMessage[] = [];
    const callbackQueries: TelegramCallbackQuery[] = [];

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

      if (u.message) {
        const m = u.message;
        messages.push({
          messageId: m.message_id,
          from: m.from
            ? {
                id: m.from.id,
                firstName: m.from.first_name,
                username: m.from.username,
              }
            : undefined,
          chat: {
            id: m.chat.id,
            type: m.chat.type,
            title: m.chat.title,
          },
          date: m.date,
          text: m.text,
          caption: m.caption,
          photo: m.photo?.map((p) => ({
            fileId: p.file_id,
            fileUniqueId: p.file_unique_id,
            width: p.width,
            height: p.height,
            fileSize: p.file_size,
          })),
          forwardFromChat: m.forward_from_chat
            ? {
                id: m.forward_from_chat.id,
                title: m.forward_from_chat.title,
                type: m.forward_from_chat.type,
              }
            : undefined,
        });
      }

      if (u.callback_query) {
        const cq = u.callback_query;
        callbackQueries.push({
          id: cq.id,
          from: {
            id: cq.from.id,
            firstName: cq.from.first_name,
            username: cq.from.username,
          },
          message: cq.message
            ? {
                messageId: cq.message.message_id,
                chat: {
                  id: cq.message.chat.id,
                  type: cq.message.chat.type,
                },
                text: cq.message.text,
              }
            : undefined,
          data: cq.data,
        });
      }
    }
    return { nextOffset, chatUpdates, messages, callbackQueries };
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<{ messageId: number }> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode ?? 'HTML',
      disable_web_page_preview: options?.disableWebPagePreview ?? false,
    };
    if (options?.replyMarkup) {
      body.reply_markup = options.replyMarkup;
    }
    if (options?.replyToMessageId) {
      body.reply_to_message_id = options.replyToMessageId;
    }
    const r = await this.request<{ message_id: number }>('sendMessage', body);
    return { messageId: r.message_id };
  }

  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    options?: EditMessageOptions,
  ): Promise<{ messageId: number }> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options?.parseMode ?? 'HTML',
      disable_web_page_preview: options?.disableWebPagePreview ?? false,
    };
    if (options?.replyMarkup) {
      body.reply_markup = options.replyMarkup;
    }
    const r = await this.request<{ message_id: number }>('editMessageText', body);
    return { messageId: r.message_id };
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert = false,
  ): Promise<boolean> {
    const body: Record<string, unknown> = {
      callback_query_id: callbackQueryId,
      show_alert: showAlert,
    };
    if (text) body.text = text;
    const r = await this.request<boolean>('answerCallbackQuery', body);
    return r;
  }

  async getFile(
    fileId: string,
  ): Promise<{ fileId: string; filePath?: string | undefined; fileSize?: number | undefined }> {
    const r = await this.request<{ file_id: string; file_path?: string; file_size?: number }>('getFile', {
      file_id: fileId,
    });
    return {
      fileId: r.file_id,
      filePath: r.file_path,
      fileSize: r.file_size,
    };
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const res = await this.fetchImpl(this.fileUrl(filePath));
    if (!res.ok) {
      throw new TelegramApiError(`Falha ao baixar arquivo: HTTP ${res.status}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption?: string,
  ): Promise<{ messageId: number }> {
    const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl };
    if (caption) {
      body.caption = caption;
      body.parse_mode = 'HTML';
    }
    const r = await this.request<{ message_id: number }>('sendPhoto', body);
    return { messageId: r.message_id };
  }

  async sendPhotoBuffer(
    chatId: string,
    buffer: Uint8Array | Buffer,
    mime: string,
    caption?: string,
  ): Promise<{ messageId: number }> {
    const form = new FormData();
    form.append('chat_id', chatId);
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    form.append('photo', new Blob([buffer as unknown as BlobPart], { type: mime }), `photo.${extension}`);
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    const res = await this.fetchImpl(this.url('sendPhoto'), {
      method: 'POST',
      body: form,
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: { message_id: number };
      description?: string;
    } | null;
    if (!json?.ok || !json.result) {
      throw new TelegramApiError(json?.description ?? `HTTP ${res.status}`);
    }
    return { messageId: json.result.message_id };
  }
}
