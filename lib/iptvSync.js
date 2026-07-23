const { db, messaging } = require('./firebaseAdmin');
const { preencherTemplate } = require('./templates');
const { consultarContaXtream } = require('./xtream');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Confere se o cliente foi renovado direto no painel IPTV de origem.
// Se a data lá estiver mais nova que a nossa, atualiza sozinho e
// dispara o mesmo aviso de renovação que o botão manual dispara
// (push + e-mail). Retorna o cliente atualizado + o texto do
// comprovante (pra quem chamou poder abrir o WhatsApp también).
async function sincronizarComPainelIPTV(id, cliente, templates) {
  if (!cliente.m3uLink) return null;

  const resultado = await consultarContaXtream(cliente.m3uLink);
  if (resultado.erro || !resultado.vencimento) return null;
  if (resultado.vencimento <= cliente.vencimento) return null;

  const clienteAtualizado = {
    ...cliente,
    vencimento: resultado.vencimento,
    status: 'ativo',
    ultimaNotificacao: { tipo: null, data: 0 },
  };

  await db.ref(`clientes/${id}`).update({
    vencimento: resultado.vencimento,
    status: 'ativo',
    ultimaNotificacao: { tipo: null, data: 0 },
  });

  await db.ref('financeiro').push({
    clienteId: id,
    clienteNome: cliente.nome,
    servidor: cliente.servidor || '—',
    valor: Number(cliente.planoValor) || 0,
    tipo: 'renovacao',
    data: Date.now(),
  });

  const corpo = preencherTemplate(templates.comprovanteRenovacao || '', clienteAtualizado);

  if (cliente.fcmToken && cliente.notificacaoAtiva) {
    try {
      await messaging.send({
        token: cliente.fcmToken,
        data: {
          title: 'Plano renovado! ✅',
          body: corpo,
          link: `${process.env.APP_URL}/meu-plano.html?id=${id}`,
        },
      });
    } catch (err) {
      console.error(`Erro ao notificar renovação automática (${id}):`, err.message);
    }
  }

  if (cliente.email) {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM,
        to: cliente.email,
        subject: preencherTemplate(templates.emailAssunto || 'Seu plano foi renovado!', clienteAtualizado),
        text: corpo,
      });
    } catch (err) {
      console.error(`Erro ao enviar e-mail de renovação automática (${id}):`, err.message);
    }
  }

  return { cliente: clienteAtualizado, comprovante: corpo };
}

module.exports = { sincronizarComPainelIPTV };
