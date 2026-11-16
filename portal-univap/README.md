# UNIVAP Pixel Academy 🎓 ▣

Portal didático **mobile-first**, PWA instalável, inspirado nas cores azul, branco e vermelho da UNIVAP com identidade visual pixel art.

## Conteúdo

- **7 disciplinas** de 2023 presentes no ZIP original: Banco de Dados, CLD I, CLD II, Eletrônica Aplicada à Informática, Princípios de Sinais, Redes de Computadores e Sistemas Computacionais.
- **308 semanas** dos planos de ensino originais, incluindo semanas sem tema definido sinalizadas, mais **16 etapas de TCC** derivadas do manual UNIVAP (total: 324).
- Cada semana com objetivos, orientação didática, vídeo de apoio, prática e lista de 3 exercícios.
- Para **cada disciplina**, lista prática de até **2,0 pontos** e um projeto próprio de **0 a 10**, com enunciado, critérios e formulário de submissão pelo GitHub.
- Apostila digital acessível e exportável em HTML, arquivos de planejamento originais, manual da monografia, downloads oficiais de softwares e cursos complementares (incluindo SumoBotStudio).
- Administrador `brunomichel00@gmail.com`: aprova e remove alunos, publica/edita/exclui atividades, cria matérias e semanas, avalia entregas, exporta CSV e acompanha gráficos e indicadores.
- Matrícula com Google, cadastro de ano/turma/matérias e aprovação antes do acesso ao material pelo portal.
- Tema claro/escuro, layout adaptado a celulares, manifest, service worker, icons e instruções de instalação.

## Como executar

O site é estático, sem build. Use um servidor HTTP, **não** `file://`:

```bash
cd Portal_Aulas_UNIVAP
python -m http.server 8080
```

Entre em `http://localhost:8080`. Configure o Firebase conforme [SETUP-FIREBASE.md](SETUP-FIREBASE.md). Login Google requer domínio autorizado, e internet para o Firebase.

## Publicação no GitHub Pages

1. Crie repositório público chamado, por exemplo, `univap-pixel-academy`.
2. Envie **todo o conteúdo desta pasta** à raiz (não somente `index.html`).
3. Em **Settings → Pages**, escolha **Deploy from a branch → main / (root)** e salve.
4. Use `https://perabru.github.io/univap-pixel-academy/` depois de confirmar a publicação nas configurações do GitHub.
5. Adicione `perabru.github.io` aos domínios autorizados do Firebase Authentication e aplique as regras.

A publicação não é realizada apenas por gerar os arquivos. Consulte as configurações do Pages para o endereço publicado real.

## Direitos, materiais e privacidade

Esta implementação foi construída com os arquivos enviados pelo professor. Todos os originais estão na pasta `materiais/` para distribuição autorizada. Os modelos de TCC e arquivos anexados têm caráter pedagógico e não substituem decisões da coordenação sobre normas vigentes. Registros pessoais e avaliações ficam no banco protegido; **GitHub Pages não é hospedagem de conteúdo privado**.

## Dashboard de notas e correção assistida por IA

- **Alunos** têm um painel de notas inspirado nos padrões visuais do [Sufee Admin Dashboard](https://github.com/puikinsh/sufee-admin-dashboard): KPIs, barras por disciplina, acompanhamento de listas de até 2 pontos, projetos de até 10, tabela de entregas com notas e feedback. O visual é código original adaptado à identidade UNIVAP/pixel art, sem cópia do framework.
- **Professor** pode solicitar uma proposta de avaliação por Gemini, ver critérios e justificativa, aplicar como rascunho e publicar a nota somente após conferir. O modelo não faz a avaliação final sozinho.
- A função protegida está em [`functions/index.js`](functions/index.js), executada no Firebase Functions, com segredo `GEMINI_API_KEY` no Cloud Secret Manager. **Nunca copie a chave para arquivos JavaScript estáticos ou commits**. Guia de implantação: [`SETUP-FIREBASE.md`](SETUP-FIREBASE.md).
- Um serviço backend precisa ser implantado para ativar o botão Gemini. Publicar a página estática no GitHub Pages não implanta a função nem aplica regras do Firebase automaticamente.
