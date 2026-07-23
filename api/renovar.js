const { db, messaging } = require('../lib/firebaseAdmin');
const { preencherTemplate } = require('../lib/templates');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { clienteId, novoVencimento } = req.body || {};
    if (!clienteId || !novoVencimento) {
      return res.status(400).json({ erro: 'clienteId e novoVencimento são obrigatórios' });
    }

    // Atualiza o cliente: novo vencimento, ativo, zera o controle de notificação
    await db.ref(`clientes/${clienteId}`).update({
      vencimento: Number(novoVencimento),
      status: 'ativo',
      ultimaNotificacao: { tipo: null, data: 0 },
    });

    const clienteSnap = await db.ref(`clientes/${clienteId}`).once('value');
    const cliente = clienteSnap.val();

    const configSnap = await db.ref('config').once('value');
    const config = configSnap.val() || {};
    const templates = config.templates || {};

    const corpo = preencherTemplate(templates.comprovanteRenovacao || '', cliente, clienteId);

    let pushEnviado = false;
    if (cliente.fcmToken && cliente.notificacaoAtiva) {
      try {
        await messaging.send({
          token: cliente.fcmToken,
          data: {
            title: 'Plano renovado! ✅',
            body: corpo,
            link: `${process.env.APP_URL}/meu-plano.html?id=${clienteId}`,
          },
        });
        pushEnviado = true;
      } catch (err) {
        console.error('Erro ao enviar push de renovação:', err.message);
      }
    }

    let emailEnviado = false;
    if (cliente.email) {
      try {
        const resultadoEmail = await resend.emails.send({
          from: process.env.RESEND_FROM,
          to: cliente.email,
          subject: preencherTemplate(templates.emailAssunto || 'Seu plano foi renovado!', cliente, clienteId),
          text: corpo,
        });
        emailEnviado = !resultadoEmail.error;
      } catch (err) {
        console.error('Erro ao enviar e-mail de renovação:', err.message);
      }
    }

    return res.status(200).json({ ok: true, pushEnviado, emailEnviado, cliente, comprovante: corpo });
  } catch (err) {
    console.error('Erro em /api/renovar:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
