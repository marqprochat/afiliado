import {
  BufferJSON,
  initAuthCreds,
  WAProto,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { Prisma, prisma } from '@afilados/db';

const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, BufferJSON.replacer)) as object;
const fromJson = <T>(v: unknown) => JSON.parse(JSON.stringify(v), BufferJSON.reviver) as T;

export async function usePostgresAuthState(sessionId: string) {
  // `findUnique` (e não `findUniqueOrThrow`): a sessão pode já ter sido apagada —
  // nesse caso `saveCreds`/`clear` viram no-ops em vez de estourar (ver `logout`).
  const row = await prisma.waSession.findUnique({
    where: { id: sessionId },
    select: { authCreds: true },
  });
  const exists = row !== null;
  const creds = row?.authCreds
    ? fromJson<AuthenticationState['creds']>(row.authCreds)
    : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const rows = await prisma.waAuthKey.findMany({
          where: { sessionId, type, keyId: { in: ids } },
        });
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const r of rows) {
          let value = fromJson<SignalDataTypeMap[T]>(r.value);
          if (type === 'app-state-sync-key' && value && WAProto?.Message?.AppStateSyncKeyData) {
            value = WAProto.Message.AppStateSyncKeyData.fromObject(
              value as object,
            ) as unknown as SignalDataTypeMap[T];
          }
          out[r.keyId] = value;
        }
        return out;
      },
      set: async (data) => {
        const ops = [];
        for (const [type, entries] of Object.entries(data)) {
          for (const [keyId, value] of Object.entries(entries ?? {})) {
            if (value === null || value === undefined) {
              ops.push(prisma.waAuthKey.deleteMany({ where: { sessionId, type, keyId } }));
            } else {
              ops.push(
                prisma.waAuthKey.upsert({
                  where: { sessionId_type_keyId: { sessionId, type, keyId } },
                  update: { value: toJson(value) },
                  create: { sessionId, type, keyId, value: toJson(value) },
                }),
              );
            }
          }
        }
        if (ops.length > 0) {
          await prisma.$transaction(ops);
        }
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      if (!exists) return;
      await prisma.waSession.update({
        where: { id: sessionId },
        data: { authCreds: toJson(state.creds) },
      });
    },
    clear: async () => {
      if (!exists) {
        await prisma.waAuthKey.deleteMany({ where: { sessionId } });
        return;
      }
      await prisma.$transaction([
        prisma.waAuthKey.deleteMany({ where: { sessionId } }),
        prisma.waSession.update({ where: { id: sessionId }, data: { authCreds: Prisma.DbNull } }),
      ]);
    },
  };
}
