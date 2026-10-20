# Casa em Dia

Uma agenda compartilhada para dividir a limpeza da república: moradores, atividades recorrentes, sorteios equilibrados, calendário, trocas e ranking. Interface em **React e Next.js**, com servidor Node.js e **SQLite no próprio computador ou servidor**. Código aberto com licença MIT.

## Começar no seu computador

1. Instale o **Node.js 24 LTS ou mais recente** pelo [site oficial](https://nodejs.org/pt). Ele já inclui o npm.
2. Abra a pasta que contém `package.json`, `server.mjs` e este arquivo.
3. No Windows, abra **Iniciar no Windows.bat**. No Mac, **Iniciar no Mac.command**. No Linux, execute `sh iniciar-linux.sh`. Outra opção em qualquer sistema é `node iniciar.mjs` no terminal.
4. O iniciador instala as dependências que faltarem e compila a interface antes de abrir o navegador. A primeira execução precisa de internet e pode levar alguns minutos. Mantenha o terminal aberto.
5. Use o link **Configure sua casa** mostrado no terminal para cadastrar o nome da república e o primeiro administrador. Esse link é privado e serve apenas para o cadastro inicial.
6. Em **Moradores**, adicione os integrantes e copie os convites. Envie cada link pessoalmente; o sistema não dispara e-mails. Cada pessoa define a própria senha.
7. Em **Administração**, escolha os dias de cada atividade recorrente, as folgas e os limites de atividades. No **Sorteador**, organize um dia, da data escolhida até domingo ou até o fim do mês.

Se o sistema impedir a abertura do iniciador, abra um terminal na pasta e execute `node iniciar.mjs`. Para parar, use **Ctrl+C**. Fechar o servidor interrompe o acesso e os sorteios automáticos; os dados continuam guardados.

### Trabalhar no código

Instale as dependências e inicie o modo de desenvolvimento:

```sh
npm ci
npm run dev
```

Abra `http://localhost:3000`. O Next.js atualiza a interface quando você salva os arquivos. Alterações nos arquivos `.mjs` do servidor exigem reiniciar o processo. Se recebeu uma cópia sem `package-lock.json`, use `npm install` na primeira instalação.

No PowerShell do Windows, se aparecer um erro de política de execução ao usar `npm`, use **`npm.cmd`** nos mesmos comandos, por exemplo `npm.cmd ci` e `npm.cmd run dev`. Não é necessário mudar a política do Windows.

Para iniciar a versão compilada:

```sh
npm run build
npm start
```

Execute `npm run build` novamente depois de mudar o código. `node iniciar.mjs` faz essa compilação em toda abertura. `npm start` precisa de uma compilação pronta. Não use `next start`: o projeto usa seu próprio servidor para manter a API e o SQLite junto do Next.js.

## Como a casa funciona

| Tela | Função |
| --- | --- |
| Hoje | Atividades, conclusão e resumo da rotina. |
| Agenda | Calendário mensal e filtro por morador. |
| Sorteador | Distribuição de um dia, até domingo ou até o fim do mês. |
| Trocas | Pedidos, aceite, recusa e cancelamento de trocas. |
| Moradores | Contatos, fotos, cadastro e convites pelo administrador. |
| Ranking | Pontos e atividades concluídas por mês. |
| Administração | Folgas, feriados, pausas, atividades recorrentes, exportação e limpeza do calendário. |

O primeiro cadastro cria o admin. Somente ele administra moradores e regras. Cada integrante conclui as próprias tarefas. Os demais moradores veem nomes e progresso; os contatos completos ficam disponíveis para o administrador.

### Escolher os dias e a quantidade de atividades

Na **Administração**, edite cada atividade recorrente e marque seus dias da semana. Por exemplo: cozinha e lixo na segunda-feira, garagem na terça. As folgas, os feriados e a pausa da casa continuam valendo.

Escolha também como limitar a divisão:

| Opção | O que será sorteado |
| --- | --- |
| Todas as atividades (`all`) | Todas as recorrentes habilitadas para cada dia, respeitando os combinados. |
| Máximo por dia (`daily`) | Até a quantidade escolhida em cada dia. |
| Máximo por semana (`weekly`) | Até a quantidade escolhida no total de segunda a domingo. |

Nos modos com limite, escolha um número inteiro de **1 a 100**. Esse limite vale para o total de atividades da agenda no período, incluindo as já cadastradas manualmente, concluídas e pausadas. Um novo sorteio preenche somente as vagas restantes. Diminuir o limite preserva as tarefas existentes, mesmo que elas já ultrapassem o novo máximo.

No limite semanal, as atividades são distribuídas pelos dias permitidos. Sortear apenas um dia não concentra nele o limite da semana; alguns dias podem ficar sem tarefas. Para organizar o restante da semana, escolha **até domingo**. A semana mantém o mesmo limite quando atravessa dois meses.

O máximo não é uma meta obrigatória: se faltarem atividades elegíveis ou dias disponíveis, o sorteio pode criar menos tarefas. A divisão prioriza os moradores com menos atividades naquele mês e não exige que todos recebam uma tarefa por semana. Com três tarefas e oito moradores, por exemplo, algumas pessoas ficam sem tarefa nessa rodada.

### Zerar o calendário e sortear novamente

Na **Administração**, use a opção de zerar o calendário e leia a confirmação antes de concluir. Antes de esvaziar a agenda ativa, ela guarda um **arquivo completo do calendário no próprio banco**, com todas as atividades de todos os meses, inclusive concluídas, seus pontos e as trocas associadas. Essas atividades deixam o calendário ativo e sua pontuação deixa o ranking ativo, que recomeça do zero. Moradores, contas, atividades recorrentes e os outros combinados da casa permanecem cadastrados. A geração automática é desligada para o calendário continuar vazio até o novo sorteio.

O histórico arquivado é incluído na **exportação JSON** da Administração para consulta. Não existe restauração automática ou importador de calendário nesta versão. Mantenha também cópias de segurança da pasta `.data`, que inclui os calendários arquivados, fotos e todos os dados de acesso. Depois de zerar, organize a nova distribuição pelo **Sorteador**. Quando quiser retomar os sorteios diários, reative **Gerar as tarefas diárias** na Administração e salve as configurações.

### Os combinados

- Uma atividade concluída até o horário limite, no fuso **America/Sao_Paulo**, soma **10 pontos** uma única vez. O minuto do prazo está incluído.
- Atividades atrasadas podem ser concluídas, mas somam zero. Não há perda de pontos. Atividades futuras só podem ser concluídas a partir do dia marcado.
- O ranking considera o mês da data da atividade no calendário ativo. Ao zerar, o ranking ativo recomeça e o histórico anterior continua arquivado no banco e disponível na exportação JSON do admin.
- O sorteio prioriza quem tem menos atividades naquele mês e desempata aleatoriamente. Respeita folgas, feriados e pausas; tarefas já sorteadas preservam o responsável. Equilibra a quantidade, sem ponderar a duração e sem obrigar todos os moradores a receber atividades em cada semana.
- As atividades recorrentes respeitam os dias escolhidos para cada uma e os limites diário ou semanal da casa. Com a geração automática ligada, o servidor verifica a cada minuto o que pode ser criado para hoje. Ele precisa estar ligado e não cria tarefas em datas passadas.
- Alterar uma atividade recorrente afeta os próximos sorteios. Para mudar uma tarefa já agendada, edite-a na agenda.
- Trocas exigem duas atividades pendentes, dentro do prazo e no mesmo mês, além do aceite do destinatário. Uma tarefa participa de um pedido pendente por vez. Concluir, reatribuir ou pausar cancela o pedido; o servidor também cancela os que saem do prazo.
- Folgas e pausas preservam atividades concluídas. Reativar um dia recupera as tarefas pausadas de hoje em diante; o histórico passado permanece.
- Os feriados nacionais brasileiros incluem Sexta-feira Santa e 20 de novembro. Adicione feriados locais. Carnaval e Corpus Christi não entram automaticamente.
- Antes de desativar um morador, reatribua suas tarefas pendentes, inclusive as pausadas.

## Compartilhar pela rede ou pela internet

Na mesma rede Wi-Fi, compartilhe o endereço **Na mesma rede Wi-Fi** mostrado no terminal, por exemplo `http://192.168.1.10:3000`. Todos acessam o mesmo servidor e o mesmo banco. Alterações são atualizadas nos demais aparelhos enquanto a agenda está em uso.

O computador deve permanecer ligado. Celular e computador precisam estar na mesma rede, sem isolamento entre clientes; permita o Node.js no firewall da rede privada se solicitado. Abra a agenda pelo endereço da rede antes de copiar convites: `localhost` no link aponta para o aparelho de quem o abre.

Para acesso pela internet, siga o **[guia passo a passo de publicação](docs/PUBLICAR.md)**. O projeto inclui `Dockerfile`, `compose.yaml` e Caddy para usar **HTTPS e banco persistente em um servidor**. A entrega não publica o aplicativo nem contrata hospedagem automaticamente.

## Banco local, banco no servidor e cópias de segurança

O SQLite cria o arquivo **`.data/casa.sqlite`** automaticamente. Não exige instalar um serviço de banco de dados ou contratar um banco externo. Atualizar a interface para React/Next.js preserva esse formato: mantenha sua pasta `.data` ao atualizar o código.

O banco do seu computador e o banco da hospedagem são **independentes**. Não há sincronização automática entre eles. Para todos usarem a mesma agenda, acessem o endereço do servidor. Para levar os dados locais à hospedagem, pare o servidor local e siga a seção de migração do guia.

Para um backup local completo, pare com **Ctrl+C** e copie a pasta `.data` inteira para um lugar privado. Para restaurar, pare o servidor, guarde uma cópia do banco atual e substitua a pasta `.data` pela cópia desejada. Não copie somente o `casa.sqlite` enquanto o app estiver ligado: o SQLite também pode usar arquivos auxiliares de transações.

As cópias contêm contatos, senhas derivadas e sessões. Não coloque `.data`, backups ou convites em um repositório público. A exportação JSON disponível ao admin inclui também os calendários arquivados, com suas atividades, pontos e trocas. Serve para consulta e portabilidade; não contém senhas nem convites e não há importador JSON nesta versão.

### Fotos dos moradores

Clique no seu avatar e abra **Meu perfil** para adicionar, trocar ou remover sua foto. O admin também pode fazer isso ao editar um integrante em **Moradores**.

Escolha um arquivo **JPEG, PNG ou WebP de até 8 MB**. O navegador recorta a imagem para um quadrado e a reduz para **256 × 256 pixels em JPEG** antes do envio. A imagem ajustada pode ter até **192 KiB** no servidor.

As fotos ficam no mesmo SQLite da casa e só podem ser consultadas por pessoas autenticadas nessa casa. O backup completo da pasta `.data` inclui as imagens. A exportação JSON contém apenas os links de consulta ao servidor, sem os arquivos das fotos; esses links dependem do servidor original e de uma sessão autenticada, portanto não substituem o backup.

## Alertas, acesso e recuperação

O sino mostra atividades pendentes. Em **Meu perfil**, cada morador pode autorizar **Web Push**, **resumo diário por e-mail** e **SMS opcional**. Web Push pode avisar com a agenda fechada; no iPhone exige iOS 16.4 ou posterior, HTTPS válido e adicionar o app à Tela de Início. E-mail usa a Brevo, com 300 envios/dia no plano gratuito; SMS exige créditos pagos e fica desligado no servidor por padrão. O envio real depende da configuração do serviço, do consentimento do morador e do servidor ligado com internet. Siga o **[guia de notificações](docs/NOTIFICACOES.md)** para configurar, ativar e testar. WhatsApp não está implementado.

Convites são privados, de uso único e válidos por 7 dias. Um novo convite invalida o anterior. O admin pode gerar **Novo acesso** para um morador redefinir a senha, encerrando as sessões antigas. Cada usuário pode mudar a própria senha no perfil. Se o único admin perder a senha, será necessário apoio de quem administra o servidor; não existe recuperação automática por e-mail. Guarde essa senha em um gerenciador de senhas.

Senhas são derivadas com scrypt e salt individual. Sessões usam cookies HttpOnly com validade de 7 dias. Autorização e validação da origem das operações acontecem no servidor. Não há senha padrão.

## Configuração e organização do código

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta do servidor. |
| `HOST` | `0.0.0.0` | Interface de rede; use `127.0.0.1` atrás de um proxy na mesma máquina. |
| `CASA_DATA_DIR` | `.data` ao lado de `server.mjs` | Diretório persistente do SQLite. |
| `CASA_PUBLIC_URL` | vazio | Endereço completo incluído nos avisos; vazio omite o link. |
| `BREVO_API_KEY` | vazio | Chave privada de API da Brevo para e-mail e SMS. |
| `BREVO_FROM_EMAIL` | vazio | Remetente de e-mail verificado na Brevo. |
| `BREVO_FROM_NAME` | `Casa em Dia` | Nome exibido nos e-mails. |
| `CASA_SMS_ENABLED` | `0` | `1` habilita SMS no servidor; exige créditos e autorização individual. |
| `BREVO_SMS_SENDER` | `CasaEmDia` | Sender ID de SMS aprovado conforme as regras do país/provedor. |
| `CASA_TRUST_PROXY` | desativado | Use `1` somente atrás de um proxy confiável que substitua `X-Forwarded-Proto` e preserve o Host. Permite cookies Secure ao acessar por HTTPS. Nesse caso, impeça acesso público direto à porta do app. |

O servidor carrega `.env` ao lado de `server.mjs` na inicialização. Copie `.env.example` somente se ainda não tiver esse arquivo e ajuste seus valores; variáveis já definidas no terminal ou no contêiner têm prioridade. Reinicie o servidor após alterações. O Compose também lê `.env` e repassa as variáveis declaradas ao contêiner. Não use o prefixo `NEXT_PUBLIC_` para valores privados. Para ativar os canais de envio, veja [docs/NOTIFICACOES.md](docs/NOTIFICACOES.md).

No PowerShell, por exemplo, um banco separado para experimentar:

```powershell
$env:CASA_DATA_DIR = Join-Path $PWD '.data-testes'
npm.cmd run dev
```

Fechar esse terminal remove a variável da sessão, sem apagar o banco de testes. Para voltar ao padrão no mesmo terminal, execute `Remove-Item Env:CASA_DATA_DIR`.

| Arquivo/pasta | Responsabilidade |
| --- | --- |
| `app/` | Rotas e estrutura do Next.js App Router. |
| `components/` | Interface React e componentes da agenda. |
| `public/` | Arquivos estáticos, como ícones. |
| `server.mjs` | Servidor HTTP, API, autenticação e SQLite. |
| `notifications.mjs` | Preferências, agendamento e envio de Web Push, e-mail e SMS. |
| ules.mjs | Datas, folgas e pontuação. |
| scheduling.mjs | Dias das atividades e limites dos sorteios. |
| profile-photos.mjs | Validação e armazenamento das fotos no SQLite. |
| `test/` | Testes das regras e operações do servidor. |
| `docs/PUBLICAR.md` | Publicação, migração, backup e atualização. |

Para verificar as regras e a API, execute `npm test`. Para validar a compilação da interface, execute `npm run build`.

O arquivo **Casa em Dia - demonstracao.html** é uma demonstração independente anterior à migração. Usa pessoas fictícias e perde os dados ao recarregar; não acessa o banco da casa nem substitui o aplicativo Next.js.

Licença MIT: veja `LICENSE`.

### Verificar a interface no navegador

Depois de `npm run build`, execute `npm run test:ui`. O teste usa o Google Chrome instalado, cria um banco temporário separado e verifica os fluxos reais e a adaptação em 320, 390, 768 e 1440 pixels. Para usar o Microsoft Edge no PowerShell: `$env:CASA_BROWSER_CHANNEL="msedge"; npm.cmd run test:ui`. Capturas ficam em `work/ui-check/`. Nenhum dado da pasta `.data` é utilizado.

A interface original foi guardada em `legacy/public/` como referência. O arquivo HTML de demonstração na raiz corresponde à versão anterior.
### Escolher os ícones das atividades

Na Administração, clique no lápis de uma atividade recorrente (ou no botão de adicionar) e escolha um dos 12 ícones de casa, cozinha, limpeza e outros cuidados. Salve a atividade. O ícone aparece na lista e é copiado para as tarefas dos próximos sorteios. Para mudar o ícone de uma tarefa já agendada, edite essa tarefa na agenda; a mudança é individual. Atividades antigas recebem um ícone sugerido pelo ambiente e pelo nome até você escolher outro.