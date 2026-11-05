# Download do termo com assinaturas eletrônicas

`signed-term-pdf.js` usa a cópia local do PDF-LIB 1.17.1. Nenhum documento, nome ou desenho é enviado a serviços externos para gerar o PDF.

O arquivo resultante contém as páginas do termo original, seguidas dos registros de assinatura do aplicativo. O original também é anexado ao PDF **com os mesmos bytes**, identificado por seu SHA-256. O arquivo original continua disponível separadamente no aplicativo.

O registro informa conta autenticada, nome, papel, data em Brasília, consentimento expresso, grupo do orientador e versão do termo. Um desenho PNG capturado pela própria pessoa é opcional. Este fluxo não emite certificado ICP-Brasil/Gov.br. Eventuais certificados anteriores devem ser verificados no original anexado, e não na cópia de consulta.

O módulo exige a aprovação da coordenação e pelo menos uma assinatura corrente. Recusa pareceres de outra versão, assinaturas sem consentimento, hash divergente, grupos inválidos, duplicações e desenhos externos/SVG. Um novo upload ou uma nova aprovação exige registros correspondentes à nova versão.

API:

```js
const { createSignedTermPdf } = await import('./signed-term-pdf.js');
const result = await createSignedTermPdf({
  originalBlob: snapshot.blob,
  filename: snapshot.filename,
  studentName: snapshot.metadata.ownerName,
  year: snapshot.metadata.year,
  review: snapshot.review,
  signatures: snapshot.signatures,
  uploadVersion: snapshot.metadata.uploadVersion || '',
  uploadedAt: snapshot.metadata.uploadedAt
});
// result.blob, result.filename, result.sha256
```

Limites: original PDF/JPG/PNG de até 3 MiB; PDF com até 30 páginas; imagens de origem com até 16 megapixels; desenho PNG de até 200 KiB e 1600 x 800 px, limitado a 1 megapixel; até 20 registros correntes. Textos extensos são quebrados em linhas e em páginas adicionais.

Testes: `node --test tests/signed-term-pdf.test.mjs`.

Fonte da dependência: pacote oficial `pdf-lib@1.17.1`, https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz. Documentação: https://pdf-lib.js.org/docs/api/classes/pdfdocument. Licença MIT preservada em `assets/vendor/pdf-lib-1.17.1.LICENSE.md` (Copyright 2019 Andrew Dillon).
