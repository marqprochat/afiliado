import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
// `proto` é reexportado do WAProto de um jeito que o cjs-module-lexer do Node não enxerga;
// importar por namespace evita "does not provide an export named 'proto'" em runtime ESM.
import * as baileys from '@whiskeysockets/baileys';

const { proto } = baileys;
import { Prisma, prisma } from '@afilados/db';

const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, BufferJSON.replacer)) as object;
const fromJson = <T>(v: unknown) => JSON.parse(JSON.stringify(v), BufferJSON.reviver) as T;

export async function usePostgresAuthState(sessionId: string) {
  const row = await prisma.waSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { authCreds: true },
  });
  const creds = row.authCreds
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
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(
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
        await prisma.$transaction(ops);
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await prisma.waSession.update({
        where: { id: sessionId },
        data: { authCreds: toJson(state.creds) },
      });
    },
    clear: async () => {
      await prisma.$transaction([
        prisma.waAuthKey.deleteMany({ where: { sessionId } }),
        prisma.waSession.update({ where: { id: sessionId }, data: { authCreds: Prisma.DbNull } }),
      ]);
    },
  };
}
