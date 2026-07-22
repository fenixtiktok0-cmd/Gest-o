# Gestão de Clientes — IPTV

Painel de gestão de clientes com cobrança e notificação de vencimento (push + e-mail).

## Estrutura
```
/api                          → funções serverless (Vercel)
  clientes.js                 → GET (listar) / POST (criar)
  clientes/[id].js             → PATCH / DELETE
  notificar-manual.js         → dispara push manual pra 1+ clientes
  cron-verificar-vencimentos.js → roda todo dia às 09h (BRT), dispara push + e-mail automáticos
/lib
  firebaseAdmin.js            → inicializa Firebase Admin SDK (via env vars)
  templates.js                → preenche variáveis das mensagens
/public
  index.html                 → painel admin (dashboard + cadastro + lista)
  meu-plano.html              → página do cliente (status do plano + ativar notificações)
  firebase-messaging-sw.js    → service worker do push
SCHEMA.md                     → estrutura de dados do Firebase
```

## Passo a passo pra subir

### 1. GitHub
Suba essa pasta inteira pro repositório que você criou (pela interface web, como sempre).
**Confirma que o `.gitignore` subiu junto** — ele impede o arquivo da service account de ir parar no repo.

### 2. Variáveis de ambiente na Vercel
No projeto da Vercel → Settings → Environment Variables, adicione:

| Nome | Valor |
|---|---|
| `FIREBASE_PROJECT_ID` | `gestao-clientes-a1664` |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-fbsvc@gestao-clientes-a1664.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | cole a `private_key` do JSON (com as quebras `\n`) |
| `FIREBASE_DATABASE_URL` | `https://gestao-clientes-a1664-default-rtdb.europe-west1.firebasedatabase.app` |
| `APP_URL` | a URL que a Vercel vai te dar (ex: `https://seu-projeto.vercel.app`) |
| `RESEND_API_KEY` | sua chave do Resend |
| `RESEND_FROM` | e-mail remetente verificado no Resend (ex: `avisos@seudominio.com`) |
| `CRON_SECRET` | qualquer string aleatória (protege o endpoint do cron) |

### 3. VAPID key
Em `public/meu-plano.html`, troque:
```js
const VAPID_KEY = "COLE_SUA_VAPID_KEY_AQUI";
```
pela chave gerada em Configurações do projeto → Cloud Messaging → Web Push certificates.

### 4. Templates de mensagem (Firebase)
Crie manualmente no Realtime Database (ou peça que eu monte um botão de configuração no painel depois):
```
/config/templates
  msg3dias: "Olá {nome}! Seu plano vence em {dias_restantes} dias..."
  msgVencimento: "Olá {nome}! Seu plano vence hoje..."
  emailAssunto: "Seu plano vence em breve"
  emailCorpo: "Olá {nome}, seu plano vence em {data_vencimento}..."
```

### 5. Regras do Firebase (importante depois dos 30 dias de teste)
Antes do modo de teste expirar, vamos travar as regras pra só o backend (Admin SDK) e o próprio painel autenticado escreverem — te aviso a tempo.

## O que falta pra ativar de fato
- [ ] Colar a VAPID key
- [ ] Configurar as env vars na Vercel
- [ ] Criar `/config/templates` no Firebase
- [ ] Testar 1 cadastro de cliente de ponta a ponta (cadastro → link `/meu-plano` → ativar notificação → push manual)
