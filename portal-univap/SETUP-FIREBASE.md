# Configuração do Firebase — Pixel Academy UNIVAP

Projeto informado: `apptcc3j`. A configuração pública do app está em `app.js`. A chave `apiKey` é um identificador público do Firebase; **a segurança depende das regras de dados**, não de ocultar a chave.

## Ativação necessária no Console

1. Entre em https://console.firebase.google.com/project/apptcc3j e selecione **Authentication → Sign-in method → Google → Enable**, salve e configure o e-mail de suporte.
2. Em **Authentication → Settings → Authorized domains**, adicione `perabru.github.io` (somente o domínio, sem `https://` ou pasta). Para testes locais, confirme o domínio `localhost`.
3. Em **Realtime Database → Rules**, faça **backup** das regras atuais e **mescle** o conteúdo de `firebase.rules.json` dentro da árvore principal `rules`. **Não substitua regras de outros aplicativos que compartilham `apptcc3j`**. Publique as regras.
4. Para testar, faça login com a conta Google verificada **brunomichel00@gmail.com**. Essa conta tem função de administradora no app e nas regras de segurança.
5. Acesse por outra conta Gmail, conclua o cadastro (ano, turma e matérias). No painel administrativo, guia **Alunos**, clique em **Aprovar**. O aluno volta a entrar/atualiza o navegador e terá acesso.
6. Na guia **Disciplinas**, crie uma matéria ou adicione uma aula. Em **Atividades**, publique desafios, defina pontuação (lista até 2, projeto até 10) e prazo. O aluno deve enviar um link de repositório GitHub, e o professor corrige em **Entregas & notas**.

### Regras de acesso implementadas

- O e-mail administrativo exige **Google autenticado e e-mail verificado**, conferido novamente pelas regras do Realtime Database.
- Alunos criam perfil como `pendente`; não conseguem torná-lo `ativo` por conta própria.
- Apenas o administrador aprova (`ativo`), remove (`removido`) ou publica/edita/exclui disciplinas, atividades e notas.
- Aluno com matrícula ativa pode enviar apenas novas entregas no seu próprio UID e ler suas entregas/notas. Não pode atribuir notas.
- Remover aluno revoga o acesso sem destruir avaliações anteriores.
- Para preservar a integridade da turma e da disciplina, as regras podem ser reforçadas com Cloud Functions caso se deseje validação servidor de cada vínculo de atividade.

### Cuidados de privacidade

O GitHub Pages serve **arquivos estáticos publicamente**. O formulário de login impede o uso normal da interface por visitantes não matriculados, mas **não protege PDFs e outros materiais incluídos no repositório** contra acesso direto por URL. Dados pessoais, submissões e notas ficam **somente no Realtime Database com regras de segurança**, nunca em HTML/JSON público do repositório.

Se precisar tornar PDFs, videoaulas ou slides **privados de verdade**, armazene-os em Firebase Storage ou outro serviço autenticado com regras próprias. Não coloque dados pessoais de alunos, senhas, tokens de administração ou avaliações no GitHub público.

### Observações técnicas

- Não é possível instalar automaticamente uma PWA em todos os celulares. Cada usuário precisa confirmar a instalação pelo navegador/sistema operacional. Em Android/Chrome, a opção **Instalar app** aparece quando os critérios PWA forem atendidos; em iOS/Safari, use **Compartilhar → Adicionar à Tela de Início**.
- O service worker oferece cache offline dos arquivos públicos da interface; login, leitura e envio dos dados no Firebase requerem internet.
- Atualizações do catálogo e das atividades ficam no Firebase, sem precisar alterar o repositório do site. Para novos arquivos de aula, faça upload a uma hospedagem confiável e publique o link pelo painel.
- Os vídeos exibidos são referências externas ou busca orientada por tema, não gravações originais fornecidas.
- O catálogo Drive de Pobre foi relacionado como portal externo; não foi possível verificar a disponibilidade ou licença de cursos específicos de GitHub nele.

## Correção assistida por Gemini — segura e com revisão do professor

O portal já inclui botão **Corrigir com Gemini** na guia **Entregas & notas**. Ao acioná-lo, uma função de servidor valida o professor (`brunomichel00@gmail.com`), consulta os arquivos legíveis de um repositório **público** GitHub, compara com o enunciado/critério e grava uma **sugestão de nota e justificativa** em `portalAulasUnivap/iaSugestoes`. A sugestão fica visível apenas ao administrador. O aluno vê nota e feedback **somente depois que o professor revisa e salva a avaliação**. Isso evita atribuições automáticas incorretas ou injustas.

A credencial Gemini fornecida na conversa **não está salva em nenhum arquivo público**. Para habilitar a IA, é necessário acesso administrativo ao projeto `apptcc3j`, Firebase CLI e permissão para Cloud Functions/Secret Manager. No computador do administrador:

```bash
npm install -g firebase-tools
firebase login
cd Portal_Aulas_UNIVAP
npm --prefix functions install
firebase functions:secrets:set GEMINI_API_KEY --project apptcc3j
# Cole a chave da Gemini Developer API apenas quando solicitado, nunca no GitHub.
firebase deploy --only functions:corrigirEntregaGemini --project apptcc3j
```

**Importante:** antes de implantar, confirme qual codebase é exibida na CLI. Este pacote define `portal-univap` como codebase para não alterar as funções de outros aplicativos. Se `--only functions:corrigirEntregaGemini` não reconhecer a função isolada com codebase, use `--only functions:portal-univap` e revise a prévia da implantação. Não execute `firebase deploy` indiscriminadamente. Pode ser exigida a ativação do plano Blaze no Firebase para implantar Cloud Functions mesmo usando o *Gemini free tier*, e o Secret Manager tem limites de cobrança próprios. Consulte a documentação oficial antes de autorizar cobranças.

Em **Realtime Database → Rules**, mescle também o nó `iaSugestoes` do arquivo `firebase.rules.json`. Não reconfigure permissões de outros apps existentes. Se a chave fornecida não for aceita pela Gemini Developer API, gere uma chave válida no [Google AI Studio](https://aistudio.google.com/app/apikey), configure-a no segredo e restrinja/remova a antiga.

### Limitações pedagógicas e privacidade

- O serviço usa o modelo `gemini-2.5-flash-lite` e somente a **faixa gratuita se o projeto/cota permitir**. A disponibilidade, limites e modelo podem mudar.
- A IA analisa texto de arquivos públicos (até 20 arquivos, amostra limitada); não executa o projeto e não pode confirmar todos os requisitos. O professor deve fazer a conferência final da nota.
- O código público do aluno selecionado é encaminhado para análise na API Gemini. Oriente os alunos a **não publicar senhas, tokens, dados pessoais ou chaves** no GitHub. Há regras específicas para uso de dados no plano gratuito da API Gemini; a escola deve avaliar a política de privacidade e obter autorizações apropriadas para estudantes.
- As regras de banco não deixam o aluno consultar nem escrever sugestões da IA. As notas oficiais continuam separadas e protegidas.
- Caso o projeto Firebase seja compartilhado com outros sites, não substitua regras antigas: **mescle as regras da árvore `portalAulasUnivap`**.

### Painel do aluno

A opção **Meu dashboard de notas** mostra cartões de desempenho, progresso por disciplina, lista prática em escala até 2,0, projeto em escala até 10, histórico e justificativa das avaliações. As médias exibidas consideram somente atividades efetivamente corrigidas, não equivalem à média final nem inserem zero por falta de entrega. A sugestão preliminar da IA não é contabilizada até o professor aprová-la.
