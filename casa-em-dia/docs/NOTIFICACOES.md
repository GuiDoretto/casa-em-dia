# Notificações, e-mail e SMS

A Casa em Dia envia lembretes por Web Push e resumos por e-mail pela Brevo. SMS usa a mesma Brevo, exige créditos pagos e fica desligado por padrão. O cadastro e as chaves do provedor precisam ser configurados por quem administra o servidor. Copiar o código não ativa uma conta de envio.

## O que cada morador recebe

Em **Meu perfil**, cada pessoa escolhe seus canais e o horário do resumo. Os canais só são usados para moradores ativos que já concluíram o cadastro e autorizaram o envio. Os contatos de destino são os do próprio perfil; o botão de teste não permite escolher outra pessoa.

| Canal | Quando envia | Condições |
| --- | --- | --- |
| Sino da agenda | Enquanto a interface está em uso. | Continua disponível sem configuração externa. |
| Web Push | A cada 15, 30, 60 ou 120 minutos, conforme o intervalo da casa, das 08h até antes das 21h. | Navegador compatível, permissão, inscrição do aparelho e HTTPS válido. |
| E-mail | Um resumo por dia, a partir do horário escolhido; padrão 09h. | Brevo configurada, e-mail no perfil e autorização do morador. |
| SMS | Um resumo por dia, a partir do horário escolhido; padrão 09h. | Serviço habilitado, créditos, remetente aprovado, telefone e autorização do morador. |

Os horários usam **America/Sao_Paulo**. O horário do resumo pode ser escolhido entre 08h e 20h59. O resumo considera apenas tarefas pendentes de hoje ou de dias anteriores. Tarefas concluídas, pausadas e futuras ficam fora. Pausar a casa bloqueia os lembretes automáticos.

O servidor precisa permanecer ligado e ter internet, mesmo com o aplicativo fechado no celular. O agendamento é verificado pelo servidor; desligar o computador interrompe os envios. Navegador, conexão, modo Foco e serviço do provedor podem adiar ou impedir a exibição. Não há garantia de chegada em um minuto exato.

## Configurar e-mail sem pagar pelo envio

O plano gratuito da Brevo inclui **300 e-mails por dia**, sem prazo de expiração. O limite é da conta inteira, compartilhado com outros usos que você fizer nela. Os planos e limites podem mudar; consulte a [página oficial do plano gratuito](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).

1. Crie sua conta na [Brevo](https://www.brevo.com/) e conclua a validação solicitada pelo serviço. Se o envio transacional estiver em análise, aguarde a aprovação.
2. Em **Configurações → Remetentes, domínios e IPs**, crie o remetente. Confirme o código recebido no e-mail. Se tiver um domínio próprio, autentique-o seguindo as instruções da Brevo para DKIM e DMARC.
3. Em **SMTP e API → Chaves de API**, gere uma chave de API. A integração usa a API HTTP, não a senha/chave de SMTP.
4. Preencha as variáveis no arquivo `.env` do projeto ou no ambiente do servidor e reinicie o aplicativo.
5. Entre no próprio perfil, autorize e-mail e use o botão de teste. Confira a caixa de entrada, spam e os logs transacionais da Brevo.

Sem domínio próprio, a Brevo permite criar e verificar um remetente por código. Endereços gratuitos como Gmail não permitem autenticar o domínio; a Brevo pode substituir o remetente por um endereço `@brevosend.com` e aplicar restrições da conta. Esse caminho depende da validação do serviço e não garante entrega. Veja [criação de remetente](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email) e [autenticação e substituição de domínio](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication).

Use os campos abaixo com seus próprios dados. Os valores vazios mantêm o envio de e-mail indisponível:

```dotenv
CASA_PUBLIC_URL=
BREVO_API_KEY=
BREVO_FROM_EMAIL=
BREVO_FROM_NAME="Casa em Dia"
CASA_SMS_ENABLED=0
BREVO_SMS_SENDER=CasaEmDia
```

`CASA_PUBLIC_URL` é opcional. Quando você tiver um endereço acessível pelos moradores, preencha-o completo, por exemplo `https://casa.seudominio.com.br`, substituindo o domínio pelo real. Só esse valor configurado pelo operador é usado para links nas mensagens. Sem ele, os avisos saem sem link. Não copie `localhost` para um link destinado ao iPhone: ele aponta para o próprio celular.

No Windows, abra o PowerShell **na pasta que contém `server.mjs`**. Se ainda não existir `.env`, crie-o:

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
notepad .env
```

Se `.env` já existir, apenas abra-o com `notepad .env` e preserve seus valores. Não sobrescreva sua configuração com o modelo. Salve e reinicie com **Ctrl+C** seguido de `node iniciar.mjs`, ou use `npm.cmd start` se a versão já estiver compilada. No desenvolvimento, reinicie `npm.cmd run dev`.

O servidor lê `.env` ao lado de `server.mjs` na inicialização. Variáveis definidas no terminal ou no contêiner têm prioridade, inclusive quando estão vazias. Por isso, mudar o arquivo exige reiniciar e pode exigir remover uma variável antiga do terminal. Não use prefixo `NEXT_PUBLIC_` nas chaves. O `.env` está excluído do Git e da imagem Docker; mantenha-o privado. O carregamento usa [process.loadEnvFile do Node.js](https://nodejs.org/api/process.html#processloadenvfilepath), cuja [implementação preserva valores já existentes no ambiente](https://github.com/nodejs/node/blob/v24.x/src/node_dotenv.cc#L62-L78).

### Docker Compose

Edite `.env` na pasta de `compose.yaml`. Além do domínio e do e-mail do certificado, preencha as variáveis Brevo. `CASA_PUBLIC_URL` precisa ser preenchida explicitamente se quiser links; não é derivada de `CASA_DOMAIN`. O Compose repassa somente as variáveis declaradas em `environment` para o app.

Aplique a configuração com:

```sh
docker compose config --quiet
docker compose up -d --build app
docker compose logs --tail=50 app
```

Após mudar apenas as variáveis, `docker compose up -d app` recria o contêiner quando necessário. `docker compose restart app` sozinho não atualiza o ambiente do contêiner, conforme a [documentação do Docker](https://docs.docker.com/reference/cli/docker/compose/restart/). Consulte também o [guia de publicação](PUBLICAR.md). Não compartilhe a saída completa de `docker compose config`: ela pode conter chaves interpoladas.

## Ativar avisos no celular

Em Android ou navegador de computador compatível, abra a agenda por HTTPS, entre no perfil e ative as notificações no aparelho. Autorize no pedido do navegador. Cada navegador/aparelho tem uma inscrição própria. Desativar a opção naquele aparelho remove sua inscrição.

No **iPhone e iPad com iOS/iPadOS 16.4 ou posterior**:

1. Abra a agenda em um endereço **HTTPS com certificado válido**.
2. No Safari, use **Compartilhar → Adicionar à Tela de Início**.
3. Abra pelo ícone criado, entre na conta e toque na opção de ativar notificações no perfil.
4. Autorize as notificações quando o iOS pedir.

O acesso `http://192.168.x.x:3000` pode abrir a agenda na rede Wi-Fi, mas não habilita Web Push: o celular precisa de um contexto seguro. `http://localhost` é uma exceção para testes no próprio computador. Apenas trocar `http` por `https` em um servidor sem certificado não resolve. Para publicar com HTTPS, siga [PUBLICAR.md](PUBLICAR.md).

A Apple não exige inscrição paga no Apple Developer Program para Web Push. Em redes com saída restrita, o servidor precisa alcançar os serviços de push dos navegadores, incluindo `https://*.push.apple.com`. Os requisitos vêm da [documentação WebKit para iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) e das [APIs de service worker em contexto seguro](https://www.w3.org/TR/service-workers/#navigator-service-worker).

### Preservar as inscrições

As chaves de Web Push são geradas uma vez pelo servidor e guardadas no mesmo SQLite da casa, junto com as inscrições dos aparelhos, preferências e registros. Não é necessário criar uma conta de push nem preencher chaves VAPID manualmente. Preserve a pasta `.data` local ou o volume `casa-em-dia-data` do Docker ao atualizar. O backup completo desse banco inclui as chaves; recriar um banco vazio gera outras chaves e os moradores precisam ativar os avisos novamente.

## Habilitar SMS opcional

**SMS não está incluído nos 300 e-mails gratuitos.** A Brevo exige créditos pré-pagos; o custo depende do país e da quantidade de segmentos da mensagem. Acentos e tamanho podem alterar o número de segmentos. Não compre créditos até conferir as condições e a disponibilidade para o Brasil na sua conta. Veja [preços e créditos de SMS](https://help.brevo.com/hc/pt/articles/208717449-Pa%C3%ADses-operacionais-e-pre%C3%A7o-para-mensagens-de-SMS).

1. Confirme que sua conta pode usar SMS transacional e compre os créditos necessários.
2. Registre/aprove o Sender ID para o país de destino quando solicitado. Novas contas criadas após **13 de março de 2026** precisam registrar esse remetente por país, segundo as [instruções oficiais](https://help.brevo.com/hc/en-us/articles/4424272648850-Send-transactional-SMS).
3. Ajuste `BREVO_SMS_SENDER` para o remetente aprovado e mude `CASA_SMS_ENABLED=1` no ambiente do servidor. Reinicie/recrie o app.
4. Cada morador informa o telefone com **DDD** e autoriza SMS no próprio perfil. Prefira o formato brasileiro completo, por exemplo `+55 11 99999-9999`. Não informe somente o número local.
5. Faça o teste pelo próprio perfil. Um teste de SMS também consome créditos reais quando a conta está configurada.

Voltar `CASA_SMS_ENABLED=0` desliga SMS no servidor. Isso não impede e-mail e Web Push. As autorizações individuais continuam necessárias quando o serviço é habilitado novamente.

## Conferir resultados e falhas

Os registros de tentativas ficam no SQLite por **90 dias**. Um resultado **aceito pelo serviço** informa que o provedor recebeu a solicitação; não confirma entrega ao destinatário. Esta versão não recebe webhooks de confirmação de entrega. Para e-mail/SMS, consulte também os logs do provedor; para Push, confira as permissões e os ajustes do aparelho.

O botão de teste envia apenas ao usuário autenticado, com intervalo mínimo de **60 segundos** entre testes por canal. Esse teste é independente do resumo diário. Sem chave/remetente, o app deve informar que o canal precisa ser configurado, em vez de registrar um envio bem-sucedido.

Chave inválida, conta em análise, falta de créditos e limite do plano podem impedir a solicitação. Um timeout de SMS pode acontecer depois de o provedor ter aceitado a cobrança: por isso, uma tentativa com resultado incerto não é reenviada automaticamente. Confira o provedor antes de tentar de novo. O controle local reduz repetições, mas não garante entrega exatamente uma vez diante de falhas de rede ou interrupção do processo.

Os testes automatizados usam respostas simuladas dos provedores e bancos temporários; não exigem conta Brevo nem enviam mensagens reais. A configuração real só fica comprovada depois de testar com sua conta e verificar o recebimento. Os canais não substituem os convites manuais nem implementam recuperação de senha por e-mail.
