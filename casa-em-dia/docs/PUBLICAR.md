# Publicar a Casa em Dia

Este guia explica como deixar a agenda online com **um servidor Linux, Docker Compose, HTTPS e SQLite persistente**. Os arquivos estão preparados; nenhum serviço foi contratado ou publicado automaticamente.

## 1. Entenda onde ficam os dados

| Onde você abre o aplicativo | Banco usado |
| --- | --- |
| `http://localhost:3000` no seu computador | `.data/casa.sqlite` no seu computador. |
| Endereço da rede Wi-Fi do computador | O mesmo banco do computador que executa o servidor. |
| `https://casa.seudominio.com.br` na hospedagem | SQLite no volume persistente do servidor. |

O banco local e o banco da hospedagem não se sincronizam. Depois da publicação, use o endereço online no celular e no computador para todo mundo acessar a mesma agenda. Você pode manter um banco separado para testar código localmente.

A configuração deste projeto mantém **uma instância Node.js** e um volume de dados. O SQLite é suficiente para essa rotina de república e não precisa de uma assinatura de banco externo. Não use várias réplicas escrevendo nesse arquivo nem um compartilhamento de rede para armazená-lo.

Apenas hospedar o HTML ou a pasta `public` não funciona: a API, o login e o SQLite precisam do servidor Node. Esta configuração com servidor customizado e SQLite não é adequada ao sistema de arquivos efêmero de funções serverless, como uma publicação padrão na Vercel. Para mudar para esse modelo seria necessário adaptar o backend e o banco.

## 2. Prepare um servidor e um domínio

Você precisará de um servidor Linux com armazenamento persistente, acesso SSH e Docker Engine com o plugin Docker Compose. Um VPS é uma opção. O domínio é o endereço que seus moradores vão usar. Antes de contratar, confira preço, armazenamento, política de backups e se o serviço permite executar contêineres continuamente. Não há contratação obrigatória de banco de dados.

1. Instale o Docker seguindo o [guia oficial para a sua distribuição Linux](https://docs.docker.com/engine/install/). Se usar Ubuntu, consulte o [guia específico](https://docs.docker.com/engine/install/ubuntu/).
2. Confirme no terminal do servidor:

   ```sh
   docker --version
   docker compose version
   ```

3. Crie no painel DNS do domínio um registro **A** de `casa` apontando para o IPv4 público do servidor. Se cadastrar um registro **AAAA**, ele também precisa apontar para um IPv6 funcional desse servidor.
4. Libere as portas **80 e 443 TCP** no firewall da hospedagem. A porta **443 UDP** permite HTTP/3 e é opcional. Mantenha seu acesso SSH funcionando. A porta 3000 do aplicativo não deve ser publicada na internet.

O Caddy receberá as conexões e obterá os certificados HTTPS. Para isso, domínio e DNS precisam estar corretos e as portas públicas precisam alcançar o servidor. O Compose já guarda os certificados em volumes próprios.

## 3. Envie o projeto e configure o domínio

Copie o código para uma pasta privada do servidor, por exemplo `/opt/casa-em-dia`, por Git ou SFTP. A pasta deve conter `package.json`, `package-lock.json`, `Dockerfile`, `compose.yaml`, `deploy/`, `app/`, os componentes e todos os arquivos do servidor, incluindo `scheduling.mjs` e `profile-photos.mjs`. Não envie `node_modules` nem `.next`: a imagem Docker prepara a versão Linux.

Se houver dados locais para levar, faça a migração da próxima seção **antes de iniciar a hospedagem**. A `.data` não entra na imagem Docker e não deve ir para um repositório público.

No terminal Linux, já dentro da pasta do projeto:

```sh
cp .env.example .env
nano .env
```

Substitua os exemplos pelos seus valores reais:

```dotenv
CASA_DOMAIN=casa.seudominio.com.br
ACME_EMAIL=voce@seudominio.com.br
```

Use somente o domínio: sem `https://`, barras ou caminho. O e-mail é usado no cadastro do certificado. O `.env` é lido pelo Compose; não é necessário alterar o código ou colocar esses dados no navegador.

Confira a configuração e construa a imagem:

```sh
docker compose config --quiet
docker compose build app
```

O Dockerfile usa Node.js 24 e executa `npm ci` e `npm run build`. Ele mantém o servidor customizado: o projeto não usa a saída `standalone` do Next.js, que é incompatível com essa forma de servidor.

## 4. Levar seu banco local, se já tiver dados

Se quiser começar uma casa vazia na hospedagem, pule esta seção. O servidor cria o banco automaticamente na primeira execução.

Para migrar a casa existente, primeiro pare o aplicativo local com **Ctrl+C** e confirme que o processo terminou. Na pasta do projeto local:

```sh
tar -czf casa-dados.tgz .data
```

O comando funciona em terminais de Linux/macOS e versões atuais do Windows. Se não tiver `tar`, compacte a pasta `.data` completa com uma ferramenta de sua confiança. Para os comandos abaixo, o arquivo precisa ser um `.tgz` contendo a pasta `.data`.

Envie o arquivo por SFTP para uma pasta `backups` **privada** dentro da pasta do projeto no servidor. Não use link público e não inclua esse arquivo no Git. No servidor, depois de construir a imagem e **antes da primeira inicialização**:

```sh
mkdir -p backups
chmod 700 backups
docker compose run --rm --no-deps --user root -v "$PWD/backups:/backup:ro" --entrypoint sh app -c 'tar -xzf /backup/casa-dados.tgz -C /app && chown -R node:node /app/.data'
```

Esse processo importa a pasta para o volume persistente e ajusta a permissão do usuário do aplicativo. Confirme que está trabalhando em uma instalação nova; se já houver um banco na hospedagem, faça um backup dele e use o procedimento de restauração da seção 7.

Na hospedagem, use sua senha de admin existente. Não será preciso recadastrar a casa. Convites antigos que começam com `localhost` ou IP da rede devem ser gerados novamente depois de abrir o endereço online.

## 5. Inicie a agenda e crie o primeiro admin

```sh
docker compose up -d
docker compose ps
docker compose logs --tail=80 app caddy
```

Acesse `https://casa.seudominio.com.br`, substituindo pelo seu domínio real. O Caddy redireciona HTTP para HTTPS. O app aguarda internamente na porta 3000; o Compose só publica as portas do Caddy.

Se o banco estiver vazio, o log do app mostrará um link como:

```text
Configure sua casa: http://localhost:3000/?configurar=TOKEN_PRIVADO
```

Copie somente o caminho e o token para seu domínio:

```text
https://casa.seudominio.com.br/?configurar=TOKEN_PRIVADO
```

Use o token real que apareceu no seu log. O link deve ficar somente com você até cadastrar o admin. Depois de um reinício antes da configuração, leia o log novamente, porque o token muda. Não crie a conta pelo endereço `localhost` no seu computador: esse endereço aponta para o computador de quem abre.

Após entrar, configure os moradores e gere os convites usando o domínio online. Na Administração, escolha os dias de cada atividade e o modo de divisão: todas as atividades, máximo por dia ou máximo por semana de segunda a domingo. Os limites vão de 1 a 100 e incluem o que já estiver agendado, inclusive tarefas manuais, concluídas e pausadas; novos sorteios apenas preenchem as vagas. No Sorteador, escolha um dia, até domingo ou até o fim do mês. Nem todos os moradores precisam receber tarefas em uma semana: a divisão considera quem tem menos atividades no mês. Se algum pedido falhar ou o HTTPS não subir, confira DNS, portas e os logs do Caddy. Se aparecer erro de permissão do SQLite, confirme que o volume `/app/.data` pertence ao usuário `node` da imagem.

## 6. Operação e atualizações

O Compose reinicia os contêineres após falha ou reinício do servidor, desde que o Docker esteja habilitado para iniciar com o sistema. Mantenha uma única instância do serviço `app`. Os sorteios automáticos só acontecem enquanto ele estiver ligado e respeitam os dias e limites configurados. As escolhas para os próximos dias sobrevivem a reinícios, e a quota semanal continua a mesma quando a semana atravessa meses. As atividades já agendadas são preservadas; se faltarem opções elegíveis, podem ser criadas menos atividades que o máximo.

Para acompanhar o funcionamento:

```sh
docker compose ps
docker compose logs --tail=100 app caddy
```

O estado `healthy` verifica se a API responde. Se um contêiner ficar `unhealthy`, investigue os logs; essa verificação não faz uma restauração automática do banco.

Antes de atualizar o código, faça um backup seguindo a próxima seção. Depois envie ou obtenha a versão nova na mesma pasta, preservando `.env` e os volumes, e execute:

```sh
docker compose up -d --build
docker compose ps
```

Recriar contêineres mantém os dados no volume **`casa-em-dia-data`**. Não execute `docker compose down -v`, `docker volume rm` ou limpezas de volumes: eles podem apagar o banco e os certificados. Um volume persistente protege de recriação de contêiner, mas não de perda do servidor; mantenha backups fora dele.

Se alterar o `deploy/Caddyfile`, valide e recarregue:

```sh
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Se mudar o domínio ou e-mail em `.env`, aplique também `docker compose up -d` para recriar o ambiente do Caddy.

### Fotos e armazenamento persistente

Cada morador pode adicionar, trocar ou remover a foto no **Meu perfil**; o admin também pode alterá-la ao editar o morador. O arquivo original precisa ser JPEG, PNG ou WebP e ter até 8 MB. Antes de enviar, o navegador recorta e reduz a imagem para JPEG de 256 × 256 pixels; o servidor aceita até 192 KiB por imagem ajustada.

As fotos são guardadas no SQLite e consultadas somente com autenticação na casa. Não é necessário criar uma pasta pública de uploads ou contratar armazenamento de imagens separado. Preserve o volume `/app/.data` e inclua-o nos backups. A exportação JSON leva apenas links de consulta às fotos no servidor, sem as imagens; esses links exigem acesso ao servidor original e login.

## 7. Fazer e restaurar backups

### Backup do servidor

O banco usa SQLite em modo WAL. Para uma cópia simples e consistente, **pare o app antes de copiar a pasta completa**. Os moradores ficarão sem acesso durante essa operação curta. Os comandos abaixo são para o terminal Linux do servidor:

```sh
mkdir -p backups
chmod 700 backups
docker compose stop app
docker compose run --rm --no-deps --user root -v "$PWD/backups:/backup" --entrypoint sh app -c 'tar -czf /backup/casa-AAAA-MM-DD-HHMM.tgz -C /app .data'
docker compose start app
```

Troque `AAAA-MM-DD-HHMM` pela data e hora para cada backup, evitando sobrescrever cópias anteriores. Confira que o arquivo foi criado e não está vazio:

```sh
ls -lh backups/casa-AAAA-MM-DD-HHMM.tgz
tar -tzf backups/casa-AAAA-MM-DD-HHMM.tgz
```

Guarde uma cópia fora do servidor em local privado. Faça isso regularmente e antes de atualizações ou de zerar o calendário. Zerar guarda o calendário completo no banco antes de retirar as tarefas e trocas da agenda ativa; o ranking ativo recomeça, e o histórico fica disponível na exportação JSON do admin. Os calendários arquivados, as configurações dos sorteios e as fotos dos moradores também fazem parte do backup da pasta `.data`. Teste uma restauração em um ambiente separado para saber que o backup funciona. Contatos, senhas derivadas e sessões fazem parte do arquivo; trate-o como dado privado da república.

### Restauração

A restauração substitui o banco atual pelo estado do backup. Primeiro faça uma cópia do estado atual seguindo os comandos acima. Verifique o conteúdo do arquivo escolhido com `tar -tzf` e mantenha-o em `backups`.

Nos comandos seguintes, substitua `casa-AAAA-MM-DD-HHMM.tgz` pelo arquivo que decidiu restaurar. O app deve permanecer parado durante toda a restauração:

```sh
docker compose stop app
docker compose run --rm --no-deps --user root -v "$PWD/backups:/backup:ro" --entrypoint sh app -c 'test -s /backup/casa-AAAA-MM-DD-HHMM.tgz && rm -f /app/.data/casa.sqlite /app/.data/casa.sqlite-wal /app/.data/casa.sqlite-shm && tar -xzf /backup/casa-AAAA-MM-DD-HHMM.tgz -C /app && chown -R node:node /app/.data'
docker compose start app
docker compose logs --tail=50 app
```

A remoção explícita do SQLite e dos dois arquivos auxiliares evita misturar transações do banco anterior com o backup. Se a extração falhar, mantenha o app parado e corrija o arquivo antes de iniciar. A exportação JSON da Administração inclui os calendários arquivados, suas atividades, pontos e trocas, mas não substitui esse backup: ela não contém todos os dados de acesso nem os arquivos das fotos e não há importador JSON. Os calendários arquivados não têm restauração automática pelo aplicativo.

## 8. Por que essa configuração

O navegador abre a interface React/Next.js, que chama as APIs do mesmo servidor Node.js. Esse processo lê e grava o SQLite em `/app/.data`, incluindo as fotos dos moradores e os dados necessários para manter os sorteios consistentes após reinícios. Na internet, o Caddy fornece HTTPS e encaminha as requisições ao processo. O volume **`casa-em-dia-data`** existe fora da camada descartável do contêiner. Os volumes do Caddy guardam seus certificados.

`CASA_TRUST_PROXY=1` está habilitado somente no Compose porque o Caddy substitui `X-Forwarded-Proto` e a porta do app fica interna. Ao acessar por HTTPS, isso permite criar cookies de sessão Secure. Se hospedar sem esse proxy, reveja essa configuração e o bloqueio do acesso direto.

Essa estrutura mantém o projeto pequeno e seus dados sob seu controle. Se no futuro houver muitas casas independentes, múltiplas instâncias ou necessidade de sincronização offline, será necessário projetar essas funções e possivelmente adotar um banco como PostgreSQL; elas não são feitas automaticamente por esta migração.

As instruções seguem as documentações oficiais de [servidor customizado do Next.js](https://nextjs.org/docs/app/guides/custom-server), [self-hosting do Next.js](https://nextjs.org/docs/app/guides/self-hosting), [volumes do Docker](https://docs.docker.com/engine/storage/volumes/), [Caddy com Docker Compose](https://caddyserver.com/docs/running#docker-compose) e [HTTPS com reverse proxy no Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy).
