# Schema — Firebase Realtime Database

```
/clientes/{clienteId}
  nome: string
  whatsapp: string          // formato: 5521999999999 (só números, com DDI)
  email: string
  planoValor: number        // valor em reais, ex: 45.00
  servidor: string          // nome do servidor IPTV usado
  vencimento: number        // timestamp (ms) da data de vencimento
  status: "ativo" | "inativo"
  fcmToken: string | null   // token do navegador do cliente p/ push
  notificacaoAtiva: boolean // se o cliente autorizou push
  ultimaNotificacao: {
    tipo: "3dias" | "vencimento" | "manual" | null
    data: number            // timestamp do último envio (evita duplicidade)
  }
  criadoEm: number

/config
  whatsappAdmin: string      // seu número, usado como fallback/registro
  templates:
    msg3dias: string         // suporta {nome} {data_vencimento} {valor_plano} {servidor}
    msgVencimento: string
    msgVencido: string
    emailAssunto: string
    emailCorpo: string
```

## Regras de negócio
- **Cron diário** (Vercel Cron, ~09:00 BRT): varre `/clientes`, calcula dias até vencimento.
  - `diasRestantes === 3` → dispara push + e-mail (tipo "3dias"), se `ultimaNotificacao.tipo !== "3dias"` no mesmo ciclo.
  - `diasRestantes === 0` → dispara push + e-mail (tipo "vencimento").
  - Atualiza `ultimaNotificacao` após cada envio, pra nunca duplicar no mesmo dia.
- **Envio manual**: botão no painel dispara push avulso pra 1 cliente (ou selecionados), sem mexer no fluxo automático.
- **WhatsApp manual**: botão gera link `wa.me/{whatsapp}?text={mensagem pré-formatada}` — abre em nova aba, você confirma envio manualmente (zero risco de bloqueio).
- **Dashboard**: contadores calculados no frontend a partir da lista de `/clientes` (total, ativos, vencendo em 3 dias, vencendo hoje, vencidos).
