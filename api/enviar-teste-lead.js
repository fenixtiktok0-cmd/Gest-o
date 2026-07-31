const { db, messaging } = require('../lib/firebaseAdmin');
const { enviarPushSeguro } = require('../lib/pushHelper');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { clienteId, m3uLink, usuario, senha, servidor, aplicativosIds, vencimento, planoValor } = req.body || {};
    if (!clienteId || !vencimento) {
      return res.status(400).json({ erro: 'clienteId e vencimento são obrigatórios' });
    }

    const clienteSnap = await db.ref(`clientes/${clienteId}`).once('value');
    const cliente = clienteSnap.val();
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

    await db.ref(`clientes/${clienteId}`).update({
      m3uLink: m3uLink || '',
      usuario: usuario || '',
      senha: senha || '',
      servidor: servidor || '',
      aplicativosIds: aplicativosIds || [],
      vencimento,
      planoValor: planoValor || 0,
      emTeste: true,
      statusLead: 'teste_enviado',
    });

    const linkAtivacao = `${process.env.APP_URL}/meu-plano.html?id=${clienteId}`;
    const corpo = `Olá ${cliente.nome}! 🎉\n\nSeu teste foi liberado! Pra ver os dados de acesso, entra nesse link e clica no botão "Ativar notificações":\n\n${linkAtivacao}\n\nDepois disso os dados aparecem na hora. Qualquer dúvida, me chama!`;

    let pushEnviado = false;
    if (cliente.fcmToken) {
      const resultado = await enviarPushSeguro({
        messaging,
        db,
        caminhoRegistro: `clientes/${clienteId}`,
        token: cliente.fcmToken,
        payload: {
          title: 'Seu teste foi liberado! 🎉',
          body: corpo,
          link: linkAtivacao,
        },
      });
      pushEnviado = resultado.enviado;
    }

    let emailEnviado = false;
    if (cliente.email) {
      try {
        const resultado = await resend.emails.send({
          from: process.env.RESEND_FROM,
          to: cliente.email,
          subject: 'Seu teste foi liberado! 🎉',
          text: corpo,
        });
        emailEnviado = !resultado.error;
      } catch (err) {
        console.error('Erro ao enviar e-mail de teste liberado:', err.message);
      }
    }

    return res.status(200).json({ ok: true, pushEnviado, emailEnviado });
  } catch (err) {
    console.error('Erro em /api/enviar-teste-lead:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
