import { Readable } from 'node:stream';

// Leitura de multipart/form-data sem dependência nova (spec 042, D3): usa o
// parser do próprio Node (undici, `Request#formData`). O corpo é contado
// enquanto chega e a leitura para com 413 assim que passa do limite, antes de
// montar o formulário. O PDF inteiro fica em memória, como já acontecia com o
// base64 — mas sem os 33% a mais do base64 nem o JSON de 70 MB para analisar.

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, statusCode: status, code, expose: true });
}

function limitedWebStream(req, maxBytes, state) {
  let received = 0;
  const source = Readable.toWeb(req);
  return source.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        state.tooLarge = true;
        controller.error(httpError(413, 'PAYLOAD_TOO_LARGE', 'Arquivo muito grande para upload.'));
        return;
      }
      controller.enqueue(chunk);
    }
  }));
}

export async function readMultipartForm(req, { maxBytes }) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw httpError(413, 'PAYLOAD_TOO_LARGE', 'Arquivo muito grande para upload.');
  }
  const state = { tooLarge: false };
  let form;
  try {
    form = await new Request('http://filtrovali.internal/', {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] },
      body: limitedWebStream(req, maxBytes, state),
      duplex: 'half'
    }).formData();
  } catch {
    if (state.tooLarge) throw httpError(413, 'PAYLOAD_TOO_LARGE', 'Arquivo muito grande para upload.');
    throw httpError(400, 'INVALID_MULTIPART', 'Formulário de envio inválido.');
  }
  const fields = {};
  const files = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      fields[name] = value;
    } else {
      files[name] = { fileName: value.name || '', type: value.type || '', bytes: Buffer.from(await value.arrayBuffer()) };
    }
  }
  return { fields, files };
}

// Middleware para rotas que recebem um arquivo e os demais campos como JSON:
// parte `payload` (JSON) → req.body; parte do arquivo → req.uploadedFile.
// Pedidos que não são multipart seguem adiante sem mudança (JSON pequeno).
export function multipartJsonWithFile({ maxBytes, fileField = 'pdf', jsonField = 'payload' }) {
  return async function parseMultipartJsonWithFile(req, _res, next) {
    if (!req.is?.('multipart/form-data')) return next();
    try {
      const { fields, files } = await readMultipartForm(req, { maxBytes });
      let body = {};
      if (fields[jsonField] !== undefined) {
        try {
          body = JSON.parse(fields[jsonField]);
        } catch {
          throw httpError(400, 'INVALID_MULTIPART', `Campo ${jsonField} não é um JSON válido.`);
        }
      }
      req.body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
      req.uploadedFile = files[fileField] || null;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
