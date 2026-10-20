# Casa em Dia na Cloudflare Free

Este guia prepara uma instalação online com HTTPS, sem comprar domínio e sem depender do computador ligado. A aplicação usa **Workers para o site/API e um Durable Object com SQLite para o banco da casa**. O endereço será parecido com `https://casa-em-dia.SEUSUBDOMINIO.workers.dev`.

O endereço da instalação atual é **[casa-em-dia.casa-em-dia.workers.dev](https://casa-em-dia.casa-em-dia.workers.dev)**. O banco local foi importado e a comparação integral de contagens e hashes das 13 tabelas foi concluída. A configuração de operação usa `CASA_SCHEDULE_ENABLED="1"`, `CASA_MIGRATION_ENABLED="0"` e `CASA_SMS_ENABLED="0"`.

As etapas de primeira publicação e importação a seguir servem para **uma instalação nova e vazia**. Para atualizar a instalação existente, publique o código mantendo os identificadores do banco e as configurações atuais; não repita o cadastro inicial nem a importação.

Os comandos de publicação e importação abaixo são operações manuais. Compilar o projeto ou executar os testes não publica a aplicação nem transfere seu banco local.

## Por que SQLite em Durable Objects

O backend existente usa consultas síncronas e transações que combinam leitura, decisões em JavaScript e escrita. O adaptador Cloudflare mantém esse comportamento com `sql.exec()` e `storage.transactionSync()`. Cada casa usa uma instância persistente; o código do site encaminha a API a essa instância. Isso também mantém o cálculo de senha fora do limite de CPU do Worker de entrada.

Esse banco não é um D1. Por isso não é necessário criar um D1 nem executar `wrangler d1` neste procedimento. Os registros continuam em SQLite, incluindo moradores, senhas protegidas por hash, histórico, fotos e configurações de notificações.

O build Cloudflare exporta as páginas Next.js para `out/`; o backend atende `/api/*`. O uso local com `npm run dev`, `npm run build` e `npm start` continua disponível. `CASA_STATIC_EXPORT=1` só é aplicado pelo build Cloudflare.

Referências: [armazenamento SQLite e transações](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) e [arquitetura de Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).

## 1. Criar a conta e guardar o código

1. Crie uma conta em [Cloudflare](https://dash.cloudflare.com/sign-up), confirme o e-mail e escolha **Workers Free**. Não é necessário cadastrar uma zona DNS ou comprar um domínio para usar `workers.dev`.
2. Em **Workers & Pages**, escolha o subdomínio da conta para os endereços `workers.dev`. Use um nome estável: mudar o endereço posteriormente exige entrar novamente nos celulares e conceder novas permissões de notificações.
3. Use o repositório [GuiDoretto/casa-em-dia](https://github.com/GuiDoretto/casa-em-dia), atualmente público. A raiz contém a pasta `casa-em-dia/` e `.github/workflows/`, conforme a estrutura entregue. A visibilidade do código não muda a privacidade do banco; dados pessoais e segredos devem permanecer fora do Git em qualquer caso.
4. Antes do primeiro envio, confira os arquivos selecionados para o commit. `.env`, `.dev.vars`, `.data*/`, `.wrangler/`, `backups/` e snapshots ficam fora do Git. Não coloque banco, fotos exportadas, tokens ou chaves dentro de `public/` ou `out/`, que são arquivos públicos do site.

O endereço `workers.dev` é provido pela Cloudflare e usa HTTPS. Veja [configuração do endereço](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## 2. Validar o pacote no computador

Abra um terminal na pasta da aplicação, a que contém `package.json`:

```powershell
cd C:\Users\guilherme\Downloads\casa-em-dia\casa-em-dia
npm ci
npm test
npm run build:cloudflare
npm run test:cloudflare
```

Use Node.js 24. O build gera o site estático e verifica o empacotamento Worker sem publicar. `test:cloudflare` usa um banco isolado no runtime Cloudflare local; não precisa de conta, credenciais, Chrome ou banco da casa. Depois de instalar as dependências, use o Wrangler local do projeto, executado por `npx wrangler`, para manter a versão do `package-lock.json`.

O nome inicial do Worker é `casa-em-dia`, em `wrangler.jsonc`. Pode alterá-lo antes da primeira publicação. Depois de usar o banco, mantenha o nome da classe `CasaDatabase`, o binding `CASA` e a identificação da casa: trocar esses identificadores pode criar outro banco vazio. Migrações de classe devem ser planejadas com backup.

## 3. Publicar a primeira versão com agendamento desligado

**Antes do primeiro deploy de uma instalação nova**, ajuste os três valores em `wrangler.jsonc` para zero, mesmo que a cópia recebida esteja configurada para a produção existente:

```json
"CASA_SCHEDULE_ENABLED": "0",
"CASA_MIGRATION_ENABLED": "0",
"CASA_SMS_ENABLED": "0"
```

Depois execute:

```powershell
npx wrangler login
npm run deploy:cloudflare
```

O login abre a autorização da sua conta Cloudflare. Confirme a conta correta. Anote o endereço HTTPS informado no fim do deploy.

O Cron está cadastrado para executar a cada minuto, mas o backend só processará o agendamento quando ele for habilitado. **Mantenha o agendamento em zero até terminar a importação e a conferência.** As rotas operacionais de dados ficam bloqueadas com `CASA_MIGRATION_ENABLED="0"`, mesmo que exista um token.

Se for começar uma casa nova, proteja o cadastro inicial: gere um token aleatório longo no seu gerenciador de senhas e cadastre-o pelo prompt, sem colocá-lo em argumentos de comando. Esse segredo é dispensável para importar uma casa existente:

```powershell
npx wrangler secret put CASA_SETUP_TOKEN
```

Sem esse segredo, o cadastro inicial fica bloqueado. A importação protegida da próxima seção continua disponível. Não compartilhe o token nem um link que o contenha. Os segredos da Cloudflare são configurados separadamente do `.env` do computador.

## 4. Escolher entre importar a casa atual e começar outra

### Importar a casa atual

**Não faça o cadastro inicial no endereço novo antes de importar.** A importação exige um destino vazio e preserva as contas já existentes.

1. Combine uma janela curta sem alterações e interrompa o aplicativo local antes do backup final. Não mantenha duas instalações aceitando gravações; elas não sincronizam entre si.
2. Faça o backup consistente e gere o snapshot de todas as tabelas:

```powershell
node scripts/cloudflare-data.mjs backup --source .data/casa.sqlite --out backups/antes-cloudflare.sqlite
node scripts/cloudflare-data.mjs verify --file backups/antes-cloudflare.json
```

Se usar outro `CASA_DATA_DIR`, substitua o caminho de origem pelo arquivo correto. O backup gera um SQLite independente e um JSON pareado; não é uma cópia isolada do arquivo principal enquanto há um WAL ativo. Guarde uma cópia protegida em outro local. Esses arquivos contêm dados pessoais e material de autenticação; não os envie para o GitHub.

3. Gere outro token aleatório com **pelo menos 32 caracteres**, diferente do token de configuração, e cadastre-o:

```powershell
npx wrangler secret put CASA_MIGRATION_TOKEN
```

4. Crie no computador um arquivo local `.env.migration`, ignorado pelo Git, contendo somente a linha `CASA_MIGRATION_TOKEN=SEU_TOKEN_DE_MIGRACAO`. Não use o token da API Cloudflare nessa linha.
5. Ative temporariamente o modo de manutenção em `wrangler.jsonc`, mantendo `CASA_SCHEDULE_ENABLED="0"`:

```json
"CASA_MIGRATION_ENABLED": "1"
```

Publique essa configuração com `npm run deploy:cloudflare`. Durante a manutenção, a API pública recusa operações de escrita com HTTP 503 e o Cron não processa a casa. As rotas operacionais exigem também o token de migração. Não faça login ou cadastro nesse intervalo.

6. Substitua o endereço de exemplo pelo seu endereço real e execute:

```powershell
node scripts/cloudflare-data.mjs import --file backups/antes-cloudflare.json --url https://casa-em-dia.SEUSUBDOMINIO.workers.dev --env-file .env.migration
node scripts/cloudflare-data.mjs verify --file backups/antes-cloudflare.json --url https://casa-em-dia.SEUSUBDOMINIO.workers.dev --env-file .env.migration
```

O importador verifica estrutura, limites, contagens, hashes e integridade das referências. A restauração é atômica e não substitui uma casa já utilizada. As fotos são importadas como bytes vinculados; não se usa um enorme literal hexadecimal SQL. O snapshot é limitado a 8 MiB; se ultrapassar esse tamanho, o processo recusa o arquivo e exige um plano de importação em lotes, sem truncar registros.

O token autoriza as rotas operacionais protegidas `/__admin/import`, `/__admin/manifest` e `/__admin/export`, somente enquanto o modo de manutenção está ativo. A comparação remota deve ser feita **antes do primeiro login e de qualquer alteração**, pois essas ações podem mudar sessões, registros ou metadados legítimos.

7. Após a comparação bem-sucedida, volte `CASA_MIGRATION_ENABLED` para `"0"` no arquivo e publique com `npm run deploy:cloudflare` **antes de fazer login**. Isso libera a API pública e fecha as rotas operacionais. O agendamento continua em zero.
8. Remova o segredo de migração ao concluir:

```powershell
npx wrangler secret delete CASA_MIGRATION_TOKEN
```

9. Agora entre com a conta existente. Confira moradores, calendário, histórico, configurações e fotos. O cookie do endereço local não passa para o domínio novo: os moradores precisam entrar novamente. No novo endereço, ative as notificações dos aparelhos novamente quando solicitado. As chaves VAPID e o histórico de entregas são preservados.

Preserve o backup e seu manifesto em local protegido. O aplicativo antigo deve continuar desligado quando os moradores começarem a usar a versão online.

Para verificar uma cópia antiga sem importá-la, use `verify --file CAMINHO.json`. Para gerar outro snapshot a partir do SQLite já copiado para `backups/`, use `export --source backups/COPIA.sqlite --out backups/COPIA.json`. `manifest --source backups/COPIA.sqlite` mostra o resumo da cópia sem imprimir senhas, fotos ou chaves.

### Começar uma casa nova

Use essa opção somente se não pretende trazer os registros atuais. Depois de cadastrar `CASA_SETUP_TOKEN`, abra `https://SEU_ENDERECO/?configurar=SEU_TOKEN_DE_CONFIGURACAO` no seu navegador e crie o primeiro administrador. O link é privado e deixa de servir para configurar a casa depois que ela existe. Não execute a importação sobre essa instalação.

## 5. Configurar e testar e-mail e notificações

O banco online não cria uma conta de envio. Para e-mail, crie uma conta Brevo, verifique o remetente e conclua a aprovação do envio transacional. Uma chave API isolada não garante autorização nem entrega. O plano gratuito consultado permite 300 e-mails por dia, compartilhados com os demais usos da conta: [limites oficiais Brevo](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).

Cadastre os valores nos prompts:

```powershell
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put BREVO_FROM_EMAIL
```

`BREVO_FROM_NAME` está definido como `Casa em Dia`. Se quiser links nos resumos, cadastre o endereço HTTPS confirmado:

```powershell
npx wrangler secret put CASA_PUBLIC_URL
```

As preferências continuam individuais. Entre no próprio perfil, autorize os canais desejados e use os botões de teste. Confira a caixa de entrada, spam e o relatório transacional da Brevo. O Web Push é enviado pelo aplicativo e depende de permissão e compatibilidade do aparelho. No iPhone, use HTTPS e adicione o site à Tela de Início antes de ativar as notificações.

SMS exige serviço/créditos pagos e fica desligado em `CASA_SMS_ENABLED="0"`. Não é necessário comprar SMS para usar a agenda, e-mail e Web Push. Mais detalhes estão em [NOTIFICACOES.md](NOTIFICACOES.md).

## 6. Habilitar as rotinas online

Depois de verificar os dados e os canais, altere no arquivo `wrangler.jsonc` somente:

```json
"CASA_SCHEDULE_ENABLED": "1"
```

Valide e publique novamente:

```powershell
npm test
npm run build:cloudflare
npm run deploy:cloudflare
```

Confira também que `CASA_MIGRATION_ENABLED` voltou para `"0"`. Essa configuração habilita a manutenção programada do backend, incluindo geração automática e lembretes conforme as preferências da casa. O Cron usa UTC; a lógica dos lembretes mantém `America/Sao_Paulo`. A execução e a entrega não são garantidas em um minuto exato. Não ligue simultaneamente o agendador Node antigo.

Para pausar as rotinas, volte o valor para `"0"` e publique. Mantenha essa configuração no arquivo versionado: uma mudança feita só no painel pode ser sobrescrita no próximo deploy. Não renomeie a classe nem apague o namespace para pausar envios.

Referência: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## 7. Publicações pelo GitHub

O CI executa instalação pelo lockfile, testes, build e verificação do runtime Cloudflare local em pushes e pull requests. Ele não usa credenciais Cloudflare, não importa dados reais e não publica. As ações GitHub usadas estão fixadas em commits completos.

A publicação tem um workflow separado, **Publicar na Cloudflare**, iniciado somente em **Actions → Run workflow**, na branch padrão. Para habilitá-lo:

1. No GitHub, abra **Settings → Environments** e crie `cloudflare-production`.
2. Na Cloudflare, crie um API token pelo modelo **Edit Cloudflare Workers**, limitado à conta de destino. Guarde-o como secret `CLOUDFLARE_API_TOKEN` nesse environment.
3. Copie o ID da conta Cloudflare para o secret `CLOUDFLARE_ACCOUNT_ID` no mesmo environment.
4. Execute o workflow manual e acompanhe o resultado. O deploy só recebe as credenciais na etapa de publicação.

As chaves de e-mail e os tokens operacionais permanecem nos secrets do Worker, cadastrados pelo Wrangler. Não coloque snapshots, banco, `.env` ou tokens de migração em artifacts do Actions. O workflow publica código e assets; não executa a importação nem altera `CASA_SCHEDULE_ENABLED` automaticamente.

Referência: [Cloudflare com GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## Fazer um backup completo da instalação online

O download inclui as 13 tabelas da aplicação, fotos, hashes das senhas, sessões e chaves das notificações. Guarde-o fora do Git e proteja o acesso ao arquivo.

1. Combine uma janela curta de manutenção. Gere/cadastre `CASA_MIGRATION_TOKEN` com pelo menos 32 caracteres e atualize seu `.env.migration` local com o mesmo token.
2. Mude `CASA_MIGRATION_ENABLED` para `"1"` em `wrangler.jsonc` e publique. Mantenha os demais valores atuais, incluindo a escolha de agendamento: o modo de manutenção já bloqueia o Cron e as escritas públicas temporariamente.
3. Escolha um nome de arquivo novo dentro de `backups/`, substitua o endereço e execute:

```powershell
node scripts/cloudflare-data.mjs download --out backups/online-2026-10-20.json --url https://casa-em-dia.SEUSUBDOMINIO.workers.dev --env-file .env.migration
node scripts/cloudflare-data.mjs verify --file backups/online-2026-10-20.json
node scripts/cloudflare-data.mjs verify --file backups/online-2026-10-20.json --url https://casa-em-dia.SEUSUBDOMINIO.workers.dev --env-file .env.migration
```

O download valida o snapshot recebido, não sobrescreve arquivos existentes e recusa dados acima do limite de 8 MiB. Faça a comparação remota ainda em manutenção, antes que novos acessos alterem registros.

4. Volte `CASA_MIGRATION_ENABLED` para `"0"` no arquivo e publique para liberar a casa e retomar o agendamento que já estava habilitado. Remova o segredo operacional com `npx wrangler secret delete CASA_MIGRATION_TOKEN`.
5. Faça uma cópia protegida do backup em outro local. Teste periodicamente a restauração em uma instalação separada e vazia; não importe sobre a produção para conferir o arquivo.

Esse procedimento é manual. O projeto não configura armazenamento externo de backups nem sua execução automática.

## Operação, recuperação e limites

- Confira periodicamente no painel o consumo de Workers e Durable Objects. O Free possui quotas e pode recusar operações ao esgotá-las; não representa capacidade ilimitada.
- O armazenamento SQLite de DO tem recuperação por ponto no tempo com bookmarks. Antes de uma alteração de esquema, registre o bookmark e faça um backup independente. Recuperar código de um deploy anterior não desfaz escritas no banco.
- Para voltar à instalação local após uso online, obtenha primeiro um backup completo e atualizado do ambiente online e reconcilie os registros. Reiniciar a cópia anterior ao corte perderia as alterações feitas online.
- Nunca exclua a classe, a migração `v1`, o Worker ou o namespace como tentativa de corrigir login ou notificações. Eles identificam o banco persistente. Conserve os identificadores entre publicações.
- O formato operacional inclui todas as tabelas e fotos; o CSV/JSON de exportação visível ao morador não deve ser tratado como backup integral de autenticação e configurações.

Em 20/10/2026, as quotas publicadas incluem 100 mil solicitações DO/dia, 5 milhões de linhas lidas/dia, 100 mil escritas/dia e 5 GB totais gratuitos. Para dimensionar cada casa, adote conservadoramente o limite de 1 GB por objeto Free descrito no FAQ; a tabela geral da mesma documentação informa 10 GB. Cada linha/BLOB tem teto de 2 MB. Consulte [preços](https://developers.cloudflare.com/durable-objects/platform/pricing/) e [limites](https://developers.cloudflare.com/durable-objects/platform/limits/) antes de ampliar o uso.

O SQLite do DO oferece [recuperação por ponto no tempo](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), mas o projeto não agenda automaticamente cópias externas completas. Mantenha o snapshot inicial e prepare/teste a rotina de backups da produção antes de depender exclusivamente dela.
