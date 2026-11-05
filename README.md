# Máximu’s no INIC

Site público com 49 artigos oficiais (8 de 2024 e 41 de 2025), galeria de 28 fotos e acesso à plataforma de grupos INIC 2027. O catálogo permite filtrar ano, nome e instituição; cards abrem os PDFs da Univap. O carrossel 3D usa as fotos em resolução completa, preserva o enquadramento e permite arraste com mouse/toque, pausa, miniaturas e ampliação. Preferência de movimento reduzido troca a animação por uma faixa de fotos.

Componentes adaptados das referências Uiverse fornecidas pelo usuário: artigos, convites, carregamento, tema, botões e carrossel. Créditos e licença em `THIRD_PARTY_NOTICES.md` e `uiverse-components.css`. A abertura usa a marca do banner enviado.

Pesquisas complementares e limites de cobertura ficam em `research/sources.json`. Pessoas com nomes semelhantes são exibidas com nome completo e instituição. Menções somente em bibliografias não entram no catálogo. Os anais de 2026 ainda não estavam acessíveis na consulta de 05/11/2026; pôsteres nas fotografias não são apresentados como PDFs publicados.

Página de divulgação da iniciação científica estudantil, com fotografias, biblioteca de artigos e acesso aos PDFs oficiais da Univap.

**Site:** https://perabru.github.io/maximus-inic/

## Conteúdo

- Identidade visual da Escola Máximu’s: índigo `#3d4094` e laranja `#f38635`.
- 28 fotografias fornecidas para esta publicação, otimizadas em WebP, com miniaturas e textos alternativos.
- Carrossel sem botões de seta, com teclado, arraste, pausa e ampliação; respeito à preferência de movimento reduzido.
- Biblioteca com pesquisa por tema, título, estudante, professor, instituição e ano.
- Instituição e relação com os professores identificadas em cada registro, incluindo eventuais divergências de cadastro.
- Links externos para os PDFs oficiais, sem copiar os artigos para este repositório.

## Fontes

Consulte [os dados de verificação](research/sources.json). A ausência de anais acessíveis de 2026 não significa ausência de apresentações ou pesquisas nessa edição. A página identifica essa limitação e encaminha ao portal oficial.

O arquivo `articles.json` contém o catálogo verificado; `photos.json` contém a galeria. As descrições são apresentações breves dos temas e não substituem os artigos.

## Publicação

Site estático sem dependências de build. No GitHub Pages, selecione **Deploy from a branch → main → /(root)**. O arquivo `.nojekyll` permite servir os arquivos sem processamento Jekyll.

Para testar localmente, sirva esta pasta em um servidor HTTP. A biblioteca e a galeria carregam seus dados por `fetch`, portanto abrir `index.html` diretamente em `file://` não é suficiente.

O código da página é separado dos direitos sobre as fotografias, a marca da escola e os artigos, que permanecem com seus respectivos titulares.


## Plataforma de acompanhamento (INIC 2027)

- `portal.html`: login/cadastro, grupos, convites, cronograma, mensagens, calendário e coordenação.
- `conformidade.html`: termo com preenchimento local e impressão; PDF em branco em `documentos/`.
- `instalar.html`: instruções Android e iOS.
- `manifest.webmanifest`, `pwa.js`, `sw.js`: instalação e cache público. Autenticação e dados privados exigem conexão e não entram no cache do service worker.
- `theme.js`: tema claro/escuro; guarda apenas a preferência de aparência no navegador.

### Autenticação e autorização

Projeto Firebase informado para este aplicativo. Email/Password e Google habilitados, com domínio GitHub Pages autorizado. Dados do app em `maximusInic`; o nó legado `items` foi mantido com suas permissões anteriores. Contas administrativas iniciais foram criadas diretamente no Auth e seus papéis foram atribuídos no banco. Nenhuma senha ou token está no código.

Novos alunos recebem somente acesso aos próprios grupos. Professores solicitam acesso de orientação no cadastro e aguardam aprovação da coordenação. Convites para alunos exigem confirmação do próprio endereço de e-mail; o login Google já fornece um e-mail verificado. O convite aparece dentro da plataforma: não há disparo automático de e-mail de convite.

As regras do servidor controlam os papéis, a entrada em grupos e o acesso aos dados. Ser coordenador na interface não depende de uma comparação de email no JavaScript. Os coordenadores veem todos os grupos e orientadores; cada orientador vê as equipes sob sua orientação. Consulte `service-contract.json` e `database.rules.json`.

### Cronograma e calendário

Ao criar um grupo, oito marcos de planejamento são gerados para o ano escolhido. Datas do INIC 2027 e valores do termo continuam sujeitos à confirmação oficial. Orientadores/coordenadores ajustam os prazos; o progresso ponderado e a situação de atraso são calculados a partir das entregas. A exportação ICS permite importar o calendário nos aplicativos de agenda. Mensagens e convites sincronizam em tempo real enquanto a plataforma está aberta e conectada.

### Validação

58 cenários aprovados no Firebase Realtime Database Emulator, incluindo isolamento de aluno/orientador, papéis protegidos, aceite atômico dos convites, validação de dados e revogação de acesso. Instruções reproduzíveis em `tests/README.md`. Verificação adicional das permissões no banco publicado: visitantes impedidos de ler perfis/grupos e ambos os coordenadores com acesso autorizado. Não há notificações push em segundo plano; os recados são internos ao aplicativo.
