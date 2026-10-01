# Envio manual — upload de imagem (design)

Data: 2026-10-01
Estende: `2026-09-30-envio-manual-cupons-design.md` (que previa "imagem opcional por URL ou upload"; o plano entregou só URL).

## Objetivo

Na página `/envio-manual`, além de informar uma URL, permitir enviar um arquivo de imagem (JPG, PNG ou WebP, até 5 MB) que sai no WhatsApp e no Telegram.

## Decisões

- O arquivo é guardado no banco, no item do lote, como bytes (não em disco e não como URL pública). O Telegram baixa por URL a partir dos servidores dele, o que exigiria a API pública, e o bloqueio de SSRF do worker barraria a URL interna.
- Telegram também recebe a imagem, por upload multipart.
- URL e arquivo são mutuamente exclusivos.

## Dados

`BatchItem` ganha `customImageData Bytes?` e `customImageType String?` (migration nova). `customImageUrl` continua existindo. Os bytes somem com o lote.

## API

- `POST /manual-send` aceita `imageData` (base64) + `imageType` (`image/jpeg` | `image/png` | `image/webp`), mutuamente exclusivo com `imageUrl`. A rota tem `bodyLimit` de 8 MB (o padrão do Fastify é 1 MB).
- O servidor decodifica o base64, rejeita mais de 5 MB e confere a assinatura real do arquivo (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`), sem confiar no tipo informado.
- `GET /batches/:id` (e qualquer resposta que inclua itens) omite os bytes e devolve `hasUploadedImage: boolean`.
- O item é gravado com `customImageData`/`customImageType` (e sem `customImageUrl`).

## Worker

- WhatsApp: item com `customImageData` → `{ kind: 'image', imageBuffer, caption }`.
- Telegram: o job do BullMQ NÃO carrega os bytes (evita até 5 MB no Redis). Carrega `customImageItemId`; `send-telegram` lê os bytes do banco e confere que o item pertence ao tenant do job. `TelegramClient.sendPhotoBuffer(chatId, buffer, mime, caption?)` envia por multipart (FormData/Blob). A regra de legenda acima de 1024 caracteres continua: foto sem legenda e depois o texto.

## Web (`/envio-manual`)

- Botão "Enviar arquivo" (`accept` JPG/PNG/WebP, máximo 5 MB) ao lado do campo de URL. Escolher um arquivo limpa a URL e vice-versa.
- Miniatura com botão "Remover"; a prévia no balão estilo WhatsApp mostra a imagem.
- Tipo ou tamanho inválido mostra mensagem em pt-BR e não envia.
- O arquivo é lido no navegador (FileReader) e vai como base64 no `POST /manual-send`.

## Testes

- Shared (schema): tipo inválido, mais de 5 MB, assinatura falsa e URL junto com arquivo são rejeitados.
- API: criação do lote com imagem, resposta de `GET /batches/:id` sem os bytes, isolamento de tenant.
- Worker: buffer entregue ao WhatsApp, upload multipart no Telegram (`sendPhotoBuffer`), item de outro tenant recusado, legenda longa.
- Web: seleção, remoção, exclusividade com a URL, erros de validação.
- Rebuild e validação no Docker antes de dar como concluído.

## Fora do escopo

Upload de imagem em cupons e produtos, redimensionamento/compressão, e limpar os bytes depois do envio.
