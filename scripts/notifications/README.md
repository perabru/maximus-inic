# Avisos do INIC

O aluno toca em **Ativar avisos** dentro da conta. A inscrição do aparelho fica privada no Firebase. No iPhone/iPad é necessário iOS/iPadOS 16.4 ou posterior e abrir o app instalado na Tela de Início; no Android, um navegador compatível deve permitir as notificações. Não há pedido automático de permissão.

O workflow `inic-reminders.yml` verifica os cronogramas e eventos a cada 15 minutos. GitHub pode atrasar execuções em períodos de demanda; não é um alarme com horário garantido. O remetente usa o fuso `America/Sao_Paulo`, envia entre 7h e 22h, avisa entregas/eventos do dia a partir de 8h e do dia seguinte a partir de 18h. Novas datas ou alterações também geram aviso. Várias mudanças na mesma verificação são reunidas em uma notificação por aparelho. A primeira execução registra a base sem disparar todas as datas antigas.

A mensagem exibida na tela bloqueada é genérica. O aluno precisa abrir o aplicativo autenticado para consultar grupo e entrega. Não são enviados nomes, temas, notas, mensagens privadas ou conteúdo dos termos.

Configuração administrativa feita fora do repositório:

- Secrets do GitHub: `INIC_NOTIFY_EMAIL`, `INIC_NOTIFY_PASSWORD`, `INIC_VAPID_PUBLIC_KEY`, `INIC_VAPID_PRIVATE_KEY`.
- Variável do repositório `INIC_NOTIFICATIONS_READY: true`, somente após concluir e aprovar a configuração; enquanto ausente, o job é ignorado.
- A conta técnica do Firebase tem somente `notificationWorkers/{uid}: true`. Ela não recebe papel de coordenador ou orientador, não tem perfil público e não lê usuários, mensagens, notas ou contratos.
- Somente a chave VAPID pública aparece em `notification-config.json`. A privada permanece nos secrets.

A ativação exige os quatro secrets, a conta técnica marcada em `notificationWorkers`, `senderReady:true` no arquivo público e a variável `INIC_NOTIFICATIONS_READY:true` no repositório. Após configurar esses itens, execute manualmente **Actions → Avisos do INIC → Run workflow** e confirme o resultado. A primeira execução estabelece a base do calendário; prazos do dia ou do dia seguinte ainda podem gerar lembrete aos aparelhos já inscritos. Sem inscrições, a execução conclui com zero destinatários.

Para suspender o remetente, remova a variável de prontidão ou altere seu valor para `false`. `senderReady:false` também impede novas inscrições pela interface e mostra a ativação pendente. Mesmo se executado diretamente, o runner encerra normalmente sem acessar o banco ou enviar mensagens quando faltam a configuração ou os secrets. As credenciais devem permanecer fora do código e dos logs.

As regras limitam o remetente à leitura de grupos, entregas, eventos e inscrições de aparelhos. Ele pode guardar os marcadores privados de entrega e remover inscrições expiradas; não pode alterar grupos, prazos ou usuários. O envio aceita somente HTTPS nos provedores FCM, Mozilla e Apple. Respostas 404/410 removem a inscrição expirada. Falhas temporárias preservam as mudanças para a próxima tentativa.

Execute `npm ci --ignore-scripts` e `npm test` nesta pasta para testar planejamento, privacidade, limites de rede e idempotência, sem credenciais e sem enviar notificações reais. `npm run send` exige os quatro secrets no ambiente.

Referências: [Web Push no iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Mozilla Autopush](https://mozilla-services.github.io/autopush-rs/), [web-push](https://github.com/web-push-libs/web-push).
